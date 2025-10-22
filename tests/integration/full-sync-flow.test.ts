/**
 * КРИТИЧНЫЙ INTEGRATION TEST
 *
 * Проверяет полный flow синхронизации:
 * 1. Client A делает UPDATE
 * 2. Триггер создаёт pending_notification
 * 3. flush_batch_notifications() отправляет NOTIFY
 * 4. Batch Handler обрабатывает
 * 5. SSE отправляется Client B (НЕ Client A) ⭐
 * 6. Client A получил данные через HTTP
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { pool } from '../../src/lib/server/db/pool';
import { redis } from '../../src/lib/server/redis';
import { sseManager } from '../../src/lib/server/sync/sse-manager';
import { syncManager } from '../../src/lib/server/sync/sync-manager';
import { postgresListener } from '../../src/lib/server/sync/postgres-listener';

describe('Full Sync Flow Integration', () => {
	beforeAll(async () => {
		// Запускаем PostgreSQL Listener
		await postgresListener.start();

		// Ждём инициализации
		await new Promise((resolve) => setTimeout(resolve, 1000));
	});

	afterAll(async () => {
		await postgresListener.stop();
		await redis.quit();
	});

	it('КРИТИЧНЫЙ: Client A (initiator) НЕ получает SSE, только Client B', async () => {
		const userId = '00000000-0000-0000-0000-000000000001';
		const clientA = 'integration-test-client-a';
		const clientB = 'integration-test-client-b';

		// Mock SSE streams
		const streamA = { writeSSE: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
		const streamB = { writeSSE: vi.fn().mockResolvedValue(undefined), close: vi.fn() };

		// 1. Регистрируем оба клиента
		await sseManager.createConnection(clientA, userId, streamA as any);
		await sseManager.createConnection(clientB, userId, streamB as any);

		// 2. Оба подписываются на orders_active
		await syncManager.subscribeCollection('orders_active', userId, clientA);
		await syncManager.subscribeCollection('orders_active', userId, clientB);

		// Очищаем моки от начальных событий (connected)
		(streamA.writeSSE as ReturnType<typeof vi.fn>).mockClear();
		(streamB.writeSSE as ReturnType<typeof vi.fn>).mockClear();

		// 3. Client A делает UPDATE заказа
		const client = await pool.connect();

		try {
			await client.query('BEGIN');
			await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
			await client.query(`SET LOCAL app.initiator_client_id = '${clientA}'`);

			// Создаём/обновляем заказ
			await client.query(
				`
				INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status)
				VALUES ('60000000-0000-0000-0000-000000000001', $1, 'Test Pickup', 'Test Delivery', 1000, 'pending')
				ON CONFLICT (id) DO UPDATE SET status = 'accepted', version = "order".version + 1
			`,
				[userId]
			);

			// 4. Флашим батч (отправит NOTIFY)
			await client.query('SELECT flush_batch_notifications()');

			await client.query('COMMIT');
		} finally {
			client.release();
		}

		// 5. Ждём обработки NOTIFY (async)
		await new Promise((resolve) => setTimeout(resolve, 500));

		// 6. ПРОВЕРКА: Client A НЕ должен получить SSE
		expect(streamA.writeSSE).not.toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'batch_update'
			})
		);

		// 7. ПРОВЕРКА: Client B ДОЛЖЕН получить SSE
		expect(streamB.writeSSE).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'batch_update',
				data: expect.stringContaining('60000000-0000-0000-0000-000000000001')
			})
		);

		// Cleanup
		await sseManager.closeConnection(clientA);
		await sseManager.closeConnection(clientB);
	}, 10000); // 10 секунд timeout

	it('Differential sync возвращает только изменения', async () => {
		const userId = '00000000-0000-0000-0000-000000000001';

		// 1. Создаём заказы
		const client = await pool.connect();

		try {
			await client.query('BEGIN');
			await client.query(`SET LOCAL app.current_user_id = '${userId}'`);

			await client.query(
				`
				INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status, version)
				VALUES 
					('70000000-0000-0000-0000-000000000001', $1, 'A1', 'A2', 1000, 'pending', 1),
					('70000000-0000-0000-0000-000000000002', $1, 'B1', 'B2', 2000, 'pending', 5)
				ON CONFLICT (id) DO NOTHING
			`,
				[userId]
			);

			await client.query('COMMIT');
		} finally {
			client.release();
		}

		// 2. Client отправляет state vector (order-2 уже есть с version 5)
		const stateVector = {
			'order:70000000-0000-0000-0000-000000000002': { version: 5 }
		};

		// 3. Запрашиваем diff
		const diff = await syncManager.syncCollection('orders_active', userId, stateVector, undefined);

		// 4. ПРОВЕРКА: order-1 должен быть в new
		expect(diff.new.length).toBeGreaterThan(0);
		const hasNewOrder = diff.new.some((item) =>
			item.key.includes('70000000-0000-0000-0000-000000000001')
		);
		expect(hasNewOrder).toBe(true);

		// 5. ПРОВЕРКА: order-2 должен быть в unchanged (version совпадает)
		const hasUnchangedOrder = diff.unchanged.some((key) =>
			key.includes('70000000-0000-0000-0000-000000000002')
		);
		expect(hasUnchangedOrder).toBe(true);
	}, 10000);

	it('Atomic batching: транзакция с N изменениями = 1 батч', async () => {
		const userId = '00000000-0000-0000-0000-000000000001';
		const testId = `batch-${Date.now()}`;
		const clientId = testId;

		// Генерируем уникальные UUID
		const crypto = await import('crypto');
		const orderId1 = crypto.randomUUID();
		const orderId2 = crypto.randomUUID();
		const orderId3 = crypto.randomUUID();

		const mockStream = { writeSSE: vi.fn().mockResolvedValue(undefined), close: vi.fn() };

		try {
			await sseManager.createConnection(clientId, userId, mockStream as any);
			await syncManager.subscribeCollection('orders_active', userId, clientId);
			await syncManager.subscribeCollection('user_notifications', userId, clientId);

			// Ждём подписок и очищаем от начальных событий
			await new Promise((resolve) => setTimeout(resolve, 200));

			(mockStream.writeSSE as ReturnType<typeof vi.fn>).mockClear();

			const client = await pool.connect();

			try {
				await client.query('BEGIN');
				await client.query(`SET LOCAL app.current_user_id = '${userId}'`);

				// Делаем 3 РАЗНЫХ изменения в одной транзакции
				// 1. Создаём заказ 1
				await client.query(
					`INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status)
				 VALUES ($1, $2, 'P1', 'D1', 1000, 'pending')`,
					[orderId1, userId]
				);

				// 2. Создаём заказ 2
				await client.query(
					`INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status)
				 VALUES ($1, $2, 'P2', 'D2', 2000, 'pending')`,
					[orderId2, userId]
				);

				// 3. Создаём заказ 3
				await client.query(
					`INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status)
				 VALUES ($1, $2, 'P3', 'D3', 3000, 'pending')`,
					[orderId3, userId]
				);

				// Флашим батч (все 3 INSERT → 1 NOTIFY)
				await client.query('SELECT flush_batch_notifications()');

				await client.query('COMMIT');
			} finally {
				client.release();
			}

			// Ждём обработки NOTIFY
			await new Promise((resolve) => setTimeout(resolve, 800));

			// ПРОВЕРКА 1: Должен быть ТОЛЬКО ОДИН SSE batch_update (не 3!)
			const batchUpdates = (mockStream.writeSSE as any).mock.calls.filter(
				(call: any) => call[0]?.event === 'batch_update'
			);

			expect(batchUpdates.length).toBe(1);
			console.log(`✅ Only ONE batch_update sent (atomic batching)`);

			// ПРОВЕРКА 2: Батч должен содержать 3 события для orders
			const batchData = JSON.parse(batchUpdates[0][0].data);
			const events = batchData.events as Array<Record<string, unknown>>;
			const orderEvents = events.filter((e) => e.entity_type === 'order');

			expect(orderEvents.length).toBe(3);
			console.log(`✅ Batch contains ${orderEvents.length} order events from 1 transaction`);

			await sseManager.closeConnection(clientId);
		} catch (error: any) {
			console.error('Atomic batching test failed:', error);
			await sseManager.closeConnection(clientId);
			throw error;
		}
	}, 15000);
});
