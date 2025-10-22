/**
 * Sync Manager
 *
 * Управление подписками на коллекции и differential sync
 */

import { redis, RedisKeys } from '../redis';
import { getCollectionSchema, resolveCollectionId } from '$lib/collections.schema';
import type { CollectionSchema } from '$lib/collections.schema';
import { setUserContext } from '../db/pool';
import { pool } from '../db/pool';

interface StateVector {
	[entityKey: string]: {
		version: number;
		fields?: string[];
	};
}

interface DiffResult {
	updated: Array<{ key: string; version: number; data: Record<string, unknown> }>;
	unchanged: string[];
	new: Array<{ key: string; version: number; data: Record<string, unknown> }>;
	removed: string[];
}

export class SyncManager {
	/**
	 * Подписаться на коллекцию
	 */
	async subscribeCollection(
		collectionId: string,
		userId: string,
		clientId: string,
		params?: Record<string, unknown>
	): Promise<void> {
		const param = params?.param as string | undefined;
		const scopedCollectionId = resolveCollectionId(collectionId, param);

		// Добавляем клиента в список подписчиков коллекции
		await redis.sadd(RedisKeys.collectionSubscriptions(scopedCollectionId, userId), clientId);

		// Добавляем коллекцию в список коллекций клиента
		await redis.sadd(RedisKeys.clientCollections(clientId), `${scopedCollectionId}:${userId}`);

		console.log(`📡 Subscribed: ${clientId} -> ${scopedCollectionId}`);
	}

	/**
	 * Отписаться от коллекции
	 */
	async unsubscribeCollection(
		collectionId: string,
		userId: string,
		clientId: string
	): Promise<void> {
		await redis.srem(RedisKeys.collectionSubscriptions(collectionId, userId), clientId);
		await redis.srem(RedisKeys.clientCollections(clientId), `${collectionId}:${userId}`);

		console.log(`🔇 Unsubscribed: ${clientId} <- ${collectionId}`);
	}

	/**
	 * Differential sync - получить изменения с учетом state vector клиента
	 */
	async syncCollection(
		collectionId: string,
		userId: string,
		stateVector: StateVector,
		params?: Record<string, unknown>
	): Promise<DiffResult> {
		const param = params?.param as string | undefined;
		const scopedCollectionId = resolveCollectionId(collectionId, param);
		const schema = getCollectionSchema(collectionId);

		if (!schema) {
			throw new Error(`Unknown collection: ${collectionId}`);
		}

		console.log(`🔄 Syncing collection ${scopedCollectionId} for user ${userId}`);

		// Получаем данные коллекции из БД с учётом RLS
		const serverData = await this.fetchCollectionData(schema, userId, params);

		// Сравниваем с state vector клиента
		const diff = this.calculateDiff(serverData, stateVector, schema);

		console.log(
			`   📊 Diff: ${diff.new.length} new, ${diff.updated.length} updated, ${diff.removed.length} removed, ${diff.unchanged.length} unchanged`
		);

		return diff;
	}

	/**
	 * Получить данные коллекции из БД
	 */
	private async fetchCollectionData(
		schema: CollectionSchema,
		userId: string,
		params?: Record<string, unknown>
	): Promise<Record<string, unknown>[]> {
		const client = await pool.connect();

		try {
			// Начинаем транзакцию (SET LOCAL работает только в транзакции)
			await client.query('BEGIN');

			// Устанавливаем контекст пользователя для RLS
			await setUserContext(client, userId);

			// Строим и выполняем запрос с параметрами
			const { query, queryParams } = this.buildQueryWithParams(schema, params, userId);

			// Выполняем
			const result = await client.query(query, queryParams);

			await client.query('COMMIT');

			return result.rows;
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	}

	/**
	 * Построить SQL запрос с параметрами (безопасный способ)
	 */
	private buildQueryWithParams(
		schema: CollectionSchema,
		params?: Record<string, unknown>,
		userId?: string
	): { query: string; queryParams: unknown[] } {
		const queryParams: unknown[] = [];
		let paramIndex = 1;

		const baseTable = schema.base_table;
		const fields = schema.fields[baseTable] || ['*'];

		// SELECT clause с правильным экранированием
		let selectClause = fields.map((f) => `"${baseTable}"."${f}"`).join(', ');

		// Добавляем поля из includes (joins)
		const joins: string[] = [];
		if (schema.includes) {
			for (const [alias, include] of Object.entries(schema.includes)) {
				const includeFields = schema.fields[include.table] || [];
				if (includeFields.length > 0) {
					const includeCols = includeFields
						.map((f) => `"${alias}"."${f}" AS "${alias}_${f}"`)
						.join(', ');
					selectClause += ', ' + includeCols;
				}

				joins.push(
					`LEFT JOIN "${include.table}" AS "${alias}" ON "${baseTable}"."${include.fk}" = "${alias}"."id"`
				);
			}
		}

		// WHERE clause
		const whereClauses: string[] = [];
		if (schema.filter) {
			for (const [key, value] of Object.entries(schema.filter)) {
				// Пропускаем специальные ключи
				if (key === 'participant_user_id' || key === 'employee_user_id') {
					continue;
				}

				if (value === '$current_user' && userId) {
					queryParams.push(userId);
					whereClauses.push(`"${baseTable}"."${key}" = $${paramIndex++}`);
				} else if (value === '$param' && params?.param) {
					queryParams.push(params.param);
					whereClauses.push(`"${baseTable}"."${key}" = $${paramIndex++}`);
				} else if (Array.isArray(value)) {
					const values = value.map((v) => `'${v}'`).join(', ');
					whereClauses.push(`"${baseTable}"."${key}" IN (${values})`);
				} else if (typeof value === 'boolean') {
					whereClauses.push(`"${baseTable}"."${key}" = ${value}`);
				} else if (value !== null && value !== undefined) {
					queryParams.push(value);
					whereClauses.push(`"${baseTable}"."${key}" = $${paramIndex++}`);
				}
			}
		}

		// Специальная обработка для participant_user_id (для chats)
		if (schema.filter?.participant_user_id === '$current_user' && baseTable === 'chat' && userId) {
			queryParams.push(userId);
			whereClauses.push(`EXISTS (
				SELECT 1 FROM "chat_participant"
				WHERE "chat_participant"."chat_id" = "chat"."id"
					AND "chat_participant"."user_id" = $${paramIndex++}
			)`);
		}

		// Специальная обработка для employee_user_id (для organizations)
		if (
			schema.filter?.employee_user_id === '$current_user' &&
			baseTable === 'organization' &&
			userId
		) {
			queryParams.push(userId);
			whereClauses.push(`EXISTS (
				SELECT 1 FROM "organization_employee"
				WHERE "organization_employee"."organization_id" = "organization"."id"
					AND "organization_employee"."user_id" = $${paramIndex++}
			)`);
		}

		const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

		const query = `
			SELECT ${selectClause}
			FROM "${baseTable}"
			${joins.join(' ')}
			${whereClause}
			ORDER BY "${baseTable}"."updated_at" DESC
		`.trim();

		return { query, queryParams };
	}

	/**
	 * Построить SQL запрос на основе schema (deprecated - используйте buildQueryWithParams)
	 */
	private buildQuery(schema: CollectionSchema, params?: Record<string, unknown>): string {
		const baseTable = schema.base_table;
		const fields = schema.fields[baseTable] || ['*'];

		// SELECT clause с правильным экранированием
		let selectClause = fields.map((f) => `"${baseTable}"."${f}"`).join(', ');

		// Добавляем поля из includes (joins)
		const joins: string[] = [];
		if (schema.includes) {
			for (const [alias, include] of Object.entries(schema.includes)) {
				const includeFields = schema.fields[include.table] || [];
				if (includeFields.length > 0) {
					const includeCols = includeFields
						.map((f) => `"${alias}"."${f}" AS "${alias}_${f}"`)
						.join(', ');
					selectClause += ', ' + includeCols;
				}

				// LEFT JOIN с правильным экранированием
				joins.push(
					`LEFT JOIN "${include.table}" AS "${alias}" ON "${baseTable}"."${include.fk}" = "${alias}"."id"`
				);
			}
		}

		// WHERE clause
		const whereClauses: string[] = [];
		if (schema.filter) {
			for (const [key, value] of Object.entries(schema.filter)) {
				// Пропускаем специальные ключи, которых нет в таблице
				if (key === 'participant_user_id' || key === 'employee_user_id') {
					// Эти фильтры обрабатываются через EXISTS ниже
					continue;
				}

				if (value === '$current_user') {
					// Используем COALESCE для fallback на NULL если не установлено
					whereClauses.push(
						`"${baseTable}"."${key}" = COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::UUID, '00000000-0000-0000-0000-000000000000'::UUID)`
					);
				} else if (value === '$param' && params?.param) {
					const param = params.param as string;
					// Валидация UUID если нужно
					if (
						key.endsWith('_id') &&
						!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param)
					) {
						continue; // Пропускаем невалидные UUID
					}
					whereClauses.push(`"${baseTable}"."${key}" = '${param}'`);
				} else if (Array.isArray(value)) {
					const values = value.map((v) => `'${v}'`).join(', ');
					whereClauses.push(`"${baseTable}"."${key}" IN (${values})`);
				} else if (typeof value === 'boolean') {
					whereClauses.push(`"${baseTable}"."${key}" = ${value}`);
				} else if (value !== null && value !== undefined) {
					whereClauses.push(`"${baseTable}"."${key}" = '${value}'`);
				}
			}
		}

		// Специальная обработка для participant_user_id (для chats)
		if (schema.filter?.participant_user_id === '$current_user' && baseTable === 'chat') {
			whereClauses.push(`EXISTS (
				SELECT 1 FROM "chat_participant"
				WHERE "chat_participant"."chat_id" = "chat"."id"
					AND "chat_participant"."user_id" = COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::UUID, '00000000-0000-0000-0000-000000000000'::UUID)
			)`);
		}

		// Специальная обработка для employee_user_id (для organizations)
		if (schema.filter?.employee_user_id === '$current_user' && baseTable === 'organization') {
			whereClauses.push(`EXISTS (
				SELECT 1 FROM "organization_employee"
				WHERE "organization_employee"."organization_id" = "organization"."id"
					AND "organization_employee"."user_id" = COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::UUID, '00000000-0000-0000-0000-000000000000'::UUID)
			)`);
		}

		const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

		// Финальный запрос
		const query = `
			SELECT ${selectClause}
			FROM "${baseTable}"
			${joins.join(' ')}
			${whereClause}
			ORDER BY "${baseTable}"."updated_at" DESC
		`.trim();

		return query;
	}

	/**
	 * Вычислить diff между серверными данными и state vector клиента
	 */
	private calculateDiff(
		serverData: Record<string, unknown>[],
		stateVector: StateVector,
		schema: CollectionSchema
	): DiffResult {
		const diff: DiffResult = {
			updated: [],
			unchanged: [],
			new: [],
			removed: []
		};

		const serverKeys = new Set<string>();

		// Проверяем каждую запись с сервера
		for (const item of serverData) {
			const itemId = item.id as string;
			const itemVersion = item.version as number;
			const entityKey = `${schema.base_table}:${itemId}`;
			serverKeys.add(entityKey);

			const clientState = stateVector[entityKey];

			if (!clientState) {
				// Новая запись для клиента
				diff.new.push({
					key: entityKey,
					version: itemVersion,
					data: this.projectFields(item, schema)
				});
			} else if (clientState.version < itemVersion) {
				// Обновлённая запись
				diff.updated.push({
					key: entityKey,
					version: itemVersion,
					data: this.projectFields(item, schema)
				});
			} else {
				// Без изменений
				diff.unchanged.push(entityKey);
			}
		}

		// Находим удалённые записи (есть у клиента, но нет на сервере)
		for (const key of Object.keys(stateVector)) {
			if (!serverKeys.has(key)) {
				diff.removed.push(key);
			}
		}

		return diff;
	}

	/**
	 * Проецировать только нужные поля (sparse fieldsets)
	 */
	private projectFields(
		data: Record<string, unknown>,
		schema: CollectionSchema
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		// Поля из базовой таблицы
		const baseFields = schema.fields[schema.base_table] || [];
		for (const field of baseFields) {
			if (data[field] !== undefined) {
				result[field] = data[field];
			}
		}

		// Поля из includes
		if (schema.includes) {
			for (const [alias, include] of Object.entries(schema.includes)) {
				const includeFields = schema.fields[include.table] || [];
				if (includeFields.length > 0) {
					const includeData: Record<string, unknown> = {};
					for (const field of includeFields) {
						const key = `${alias}_${field}`;
						if (data[key] !== undefined) {
							includeData[field] = data[key];
						}
					}
					result[alias] = includeData;
				}
			}
		}

		return result;
	}

	/**
	 * Получить статистику подписок
	 */
	async getSubscriptionStats(): Promise<{
		totalSubscriptions: number;
		uniqueCollections: number;
		uniqueUsers: number;
	}> {
		const keys = await redis.keys('collection_subscriptions:*');

		const collections = new Set<string>();
		const users = new Set<string>();

		for (const key of keys) {
			const parts = key.split(':');
			if (parts.length >= 3) {
				collections.add(parts[1]);
				users.add(parts[2]);
			}
		}

		return {
			totalSubscriptions: keys.length,
			uniqueCollections: collections.size,
			uniqueUsers: users.size
		};
	}
}

// Singleton instance
export const syncManager = new SyncManager();
