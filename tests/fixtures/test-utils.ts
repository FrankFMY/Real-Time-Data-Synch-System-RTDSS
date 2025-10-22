/**
 * Test Utilities
 *
 * Вспомогательные функции для тестов
 */

import { expect, vi } from 'vitest';
import { pool } from '../../src/lib/server/db/pool';
import { redis } from '../../src/lib/server/redis';

/**
 * Очистить Redis от тестовых данных
 */
export async function cleanupRedis() {
	const keys = await redis.keys('*test*');
	if (keys.length > 0) {
		await redis.del(...keys);
	}

	// Очищаем все subscription ключи
	const subKeys = await redis.keys('collection_subscriptions:*');
	if (subKeys.length > 0) {
		await redis.del(...subKeys);
	}

	const clientKeys = await redis.keys('client_collections:*');
	if (clientKeys.length > 0) {
		await redis.del(...clientKeys);
	}

	const userKeys = await redis.keys('user_clients:*');
	if (userKeys.length > 0) {
		await redis.del(...userKeys);
	}
}

/**
 * Очистить тестовые данные из PostgreSQL
 */
export async function cleanupDatabase() {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		// Удаляем ВСЕ тестовые данные (ID начинается с цифр 1-9, demo user = 0)
		await client.query(`
			DELETE FROM order_history 
			WHERE order_id::text ~ '^[1-9]'
		`);

		await client.query(`
			DELETE FROM "order" 
			WHERE id::text ~ '^[1-9]'
		`);

		await client.query(`
			DELETE FROM notification 
			WHERE id::text ~ '^[1-9]'
		`);

		await client.query(`
			DELETE FROM message 
			WHERE id::text ~ '^[1-9]'
		`);

		await client.query(`
			DELETE FROM chat_participant 
			WHERE id::text ~ '^[1-9]'
		`);

		await client.query(`
			DELETE FROM chat 
			WHERE id::text ~ '^[1-9]'
		`);

		await client.query(`
			DELETE FROM organization_employee 
			WHERE id::text ~ '^[1-9]'
		`);

		await client.query(`
			DELETE FROM organization 
			WHERE id::text ~ '^[1-9]'
		`);

		// Удаляем тестовых пользователей (НЕ demo user)
		await client.query(`
			DELETE FROM "user" 
			WHERE id::text ~ '^[1-9]'
		`);

		// Очищаем pending_notifications
		await client.query('TRUNCATE TABLE pending_notification');

		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Создать тестовый заказ
 */
export async function createTestOrder(
	customerId: string,
	overrides?: Partial<{
		status: string;
		total: number;
		driver_id: string;
	}>
) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');
		await client.query(`SET LOCAL app.current_user_id = '${customerId}'`);

		const result = await client.query(
			`
			INSERT INTO "order" (customer_id, driver_id, pickup_address, delivery_address, total, status)
			VALUES ($1, $2, 'Test Pickup', 'Test Delivery', $3, $4)
			RETURNING *
		`,
			[
				customerId,
				overrides?.driver_id || null,
				overrides?.total || 1000,
				overrides?.status || 'pending'
			]
		);

		await client.query('COMMIT');

		return result.rows[0];
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Ждать обработки NOTIFY события
 */
export async function waitForNotifyProcessing(ms: number = 500) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Создать mock SSE stream для тестов
 */
export function createMockSSEStream() {
	return {
		writeSSE: vi.fn().mockResolvedValue(undefined),
		close: vi.fn(),
		onAbort: vi.fn(),
		sleep: vi.fn()
	};
}

/**
 * Получить все SSE batch_update события из mock stream
 */
export function getBatchUpdateEvents(mockStream: any): any[] {
	return mockStream.writeSSE.mock.calls
		.filter((call: any) => call[0]?.event === 'batch_update')
		.map((call: any) => {
			try {
				return JSON.parse(call[0].data);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

/**
 * Проверить что клиент НЕ получил SSE batch_update
 */
export function assertNoBatchUpdateSSE(mockStream: any, message?: string) {
	const batchEvents = getBatchUpdateEvents(mockStream);
	expect(batchEvents.length).toBe(0);
	if (message) {
		console.log(`✅ ${message}`);
	}
}

/**
 * Проверить что клиент получил SSE batch_update
 */
export function assertHasBatchUpdateSSE(mockStream: any, message?: string) {
	const batchEvents = getBatchUpdateEvents(mockStream);
	expect(batchEvents.length).toBeGreaterThan(0);
	if (message) {
		console.log(`✅ ${message}`);
	}
	return batchEvents;
}
