/**
 * Batch Update Handler
 *
 * Обработка батчей обновлений от PostgreSQL NOTIFY
 * - Дедупликация событий
 * - Исключение initiator из рассылки
 * - Chunking больших батчей
 * - Custom access filtering
 */

import { redis, RedisKeys } from '../redis';
import { sseManager } from './sse-manager';

interface BatchEvent {
	entity_type: string;
	entity_id: string;
	entity_version: number;
	affected_collections: string[];
	affected_users: string[];
	data_snapshot: Record<string, unknown>;
	initiator_client_id?: string;
	operation: 'INSERT' | 'UPDATE' | 'DELETE';
}

interface BatchNotification {
	tx_id: string;
	events: BatchEvent[];
	timestamp: number;
	initiator_client_id?: string;
	event_count: number;
}

const MAX_BATCH_SIZE = 100; // Максимум событий в одном SSE сообщении

export class BatchUpdateHandler {
	/**
	 * Обработать батч обновлений
	 */
	async handleBatch(payload: string): Promise<void> {
		let batch: BatchNotification;

		try {
			batch = JSON.parse(payload);
		} catch (error) {
			console.error('❌ Failed to parse batch notification:', error);
			return;
		}

		console.log(
			`📦 Processing batch ${batch.tx_id}: ${batch.event_count} events, initiator: ${batch.initiator_client_id || 'none'}`
		);

		// Строим батчи для клиентов с дедупликацией
		const clientBatches = await this.buildClientBatches(batch.events, batch.initiator_client_id);

		let totalSent = 0;

		// Отправляем дедуплицированные батчи
		for (const [clientId, dedupedEvents] of clientBatches) {
			// Chunking для больших батчей
			const chunks = this.chunkEvents(dedupedEvents);

			for (let i = 0; i < chunks.length; i++) {
				const success = await sseManager.sendToClient(clientId, {
					type: 'batch_update',
					data: {
						tx_id: chunks.length > 1 ? `${batch.tx_id}_chunk_${i}` : batch.tx_id,
						timestamp: batch.timestamp,
						events: chunks[i],
						is_partial: chunks.length > 1,
						chunk_index: i,
						total_chunks: chunks.length
					}
				});

				if (success) {
					totalSent++;
				}
			}
		}

		console.log(
			`✅ Batch ${batch.tx_id} processed: ${totalSent} messages sent to ${clientBatches.size} clients`
		);
	}

	/**
	 * Построить батчи для каждого клиента с дедупликацией
	 */
	private async buildClientBatches(
		events: BatchEvent[],
		initiatorClientId?: string
	): Promise<Map<string, BatchEvent[]>> {
		const clientBatches = new Map<string, Map<string, BatchEvent>>();

		for (const event of events) {
			const { affected_users, affected_collections } = event;

			// Для каждого затронутого пользователя
			for (const userId of affected_users) {
				// Получаем всех клиентов этого пользователя из Redis
				const userClients = await redis.smembers(RedisKeys.userClients(userId));

				for (const clientId of userClients) {
					// ВАЖНО: Пропускаем initiator
					if (initiatorClientId && clientId === initiatorClientId) {
						console.log(`   ⏭️  Skipping initiator: ${clientId}`);
						continue;
					}

					// Проверяем: подписан ли клиент на затронутые коллекции?
					const subscribedToAny = await this.isSubscribedToAny(
						clientId,
						userId,
						affected_collections
					);

					if (!subscribedToAny) {
						continue;
					}

					// Инициализируем Map для дедупликации
					if (!clientBatches.has(clientId)) {
						clientBatches.set(clientId, new Map());
					}

					const clientEvents = clientBatches.get(clientId)!;
					const entityKey = `${event.entity_type}:${event.entity_id}`;

					// ДЕДУПЛИКАЦИЯ: берём последнюю версию entity
					const existing = clientEvents.get(entityKey);
					if (!existing || existing.entity_version < event.entity_version) {
						clientEvents.set(entityKey, event);
					}
				}
			}
		}

		// Конвертируем Map<entityKey, event> в Array
		const result = new Map<string, BatchEvent[]>();
		for (const [clientId, eventsMap] of clientBatches) {
			result.set(clientId, Array.from(eventsMap.values()));
		}

		return result;
	}

	/**
	 * Проверить подписан ли клиент хотя бы на одну из коллекций
	 */
	private async isSubscribedToAny(
		clientId: string,
		userId: string,
		collections: string[]
	): Promise<boolean> {
		// Получаем все коллекции клиента одним запросом
		const clientCollections = await redis.smembers(RedisKeys.clientCollections(clientId));
		const clientCollectionIds = new Set(clientCollections.map((key) => key.split(':')[0]));

		// Проверяем пересечение
		for (const collectionId of collections) {
			if (clientCollectionIds.has(collectionId)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Разбить события на чанки для больших батчей
	 */
	private chunkEvents(events: BatchEvent[]): BatchEvent[][] {
		if (events.length <= MAX_BATCH_SIZE) {
			return [events];
		}

		const chunks: BatchEvent[][] = [];
		for (let i = 0; i < events.length; i += MAX_BATCH_SIZE) {
			chunks.push(events.slice(i, i + MAX_BATCH_SIZE));
		}

		return chunks;
	}

	/**
	 * Отправить специальное событие об изменении прав доступа
	 */
	async handleAccessChange(userId: string, entityType: string, entityId: string): Promise<void> {
		const userClients = await redis.smembers(RedisKeys.userClients(userId));

		for (const clientId of userClients) {
			await sseManager.sendToClient(clientId, {
				type: 'access_changed',
				data: {
					entity_type: entityType,
					entity_id: entityId,
					timestamp: Date.now()
				}
			});
		}

		console.log(`🔐 Access change notification sent to user ${userId}`);
	}

	/**
	 * Отправить событие отзыва доступа (требует ре-синхронизацию)
	 */
	async handleAccessRevoked(userId: string): Promise<void> {
		const userClients = await redis.smembers(RedisKeys.userClients(userId));

		for (const clientId of userClients) {
			await sseManager.sendToClient(clientId, {
				type: 'access_revoked',
				data: {
					timestamp: Date.now(),
					message: 'Your access has been revoked. Please re-sync.'
				}
			});
		}

		console.log(`🚫 Access revoked notification sent to user ${userId}`);
	}
}

// Singleton instance
export const batchUpdateHandler = new BatchUpdateHandler();
