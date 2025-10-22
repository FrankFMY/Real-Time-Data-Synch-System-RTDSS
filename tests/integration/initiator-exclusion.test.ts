/**
 * ⭐ САМЫЙ КРИТИЧНЫЙ TEST ⭐
 *
 * Проверка Initiator Exclusion:
 * - Client A делает UPDATE → получает данные через HTTP
 * - Client B → получает данные через SSE
 * - Client A НЕ получает через SSE (no duplication!)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import app from '../../src/lib/server/api/index';
import { pool } from '../../src/lib/server/db/pool';
import { sseManager } from '../../src/lib/server/sync/sse-manager';
import { syncManager } from '../../src/lib/server/sync/sync-manager';
import { postgresListener } from '../../src/lib/server/sync/postgres-listener';

describe('⭐ INITIATOR EXCLUSION ⭐', () => {
	const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
	const TEST_SESSION_TOKEN = 'demo-session-token';

	beforeAll(async () => {
		// Запускаем PostgreSQL Listener
		if (!postgresListener.isActive()) {
			await postgresListener.start();
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	});

	afterAll(async () => {
		// НЕ останавливаем listener (может использоваться другими тестами)
		// await postgresListener.stop();
	});

	it('Client A (initiator) получает данные ТОЛЬКО через HTTP, НЕ через SSE', async () => {
		// Уникальные ID для изоляции теста
		const testId = `init-test-${Date.now()}`;
		const clientA = `${testId}-a`;
		const clientB = `${testId}-b`;

		// Mock SSE streams
		const streamA = {
			writeSSE: vi.fn().mockResolvedValue(undefined),
			close: vi.fn(),
			onAbort: vi.fn(),
			sleep: vi.fn()
		};

		const streamB = {
			writeSSE: vi.fn().mockResolvedValue(undefined),
			close: vi.fn(),
			onAbort: vi.fn(),
			sleep: vi.fn()
		};

		try {
			// ==========================================
			// SETUP: Регистрируем оба клиента
			// ==========================================

			await sseManager.createConnection(clientA, TEST_USER_ID, streamA as any);
			await sseManager.createConnection(clientB, TEST_USER_ID, streamB as any);

			await syncManager.subscribeCollection('orders_active', TEST_USER_ID, clientA);
			await syncManager.subscribeCollection('orders_active', TEST_USER_ID, clientB);

			// Ждём завершения подписок
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Очищаем моки от начальных событий (connected)
			streamA.writeSSE.mockClear();
			streamB.writeSSE.mockClear();

			console.log('📋 Setup complete: 2 clients registered and subscribed');

			// ==========================================
			// ACTION: Client A создаёт заказ
			// ==========================================

			const request = new Request('http://localhost/orders', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': clientA // ⭐ ИНИЦИАТОР
				},
				body: JSON.stringify({
					pickup_address: 'Integration Test Pickup',
					delivery_address: 'Integration Test Delivery',
					total: 5000
				}),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});
			const result = await response.json();

			console.log('📋 Client A made POST /api/orders:', result);

			// ==========================================
			// ASSERTION 1: Client A получил HTTP response
			// ==========================================

			expect(response.status).toBe(200);
			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.meta?.excluded_from_sse).toBe(true);

			console.log('✅ ASSERTION 1: Client A received HTTP response');

			// ==========================================
			// ASSERTION 2: Ждём обработки NOTIFY
			// ==========================================

			await new Promise((resolve) => setTimeout(resolve, 1500));

			// ==========================================
			// ASSERTION 3: Client A НЕ получил SSE ⭐
			// ==========================================

			const clientA_SSE_calls = streamA.writeSSE.mock.calls.filter((call: any) => {
				try {
					const event = call[0];
					return event?.event === 'batch_update';
				} catch {
					return false;
				}
			});

			expect(clientA_SSE_calls.length).toBe(0);
			console.log('✅ ASSERTION 3: Client A did NOT receive SSE (initiator excluded)');

			// ==========================================
			// ASSERTION 4: Client B получил SSE ⭐
			// ==========================================

			const clientB_SSE_calls = streamB.writeSSE.mock.calls.filter((call: any) => {
				try {
					const event = call[0];
					return event?.event === 'batch_update';
				} catch {
					return false;
				}
			});

			expect(clientB_SSE_calls.length).toBeGreaterThan(0);
			console.log('✅ ASSERTION 4: Client B received SSE batch_update');

			// ПРОВЕРКА: Батч содержит правильные данные
			const batchEvent = clientB_SSE_calls[0][0] as Record<string, unknown>;
			const batchData = JSON.parse(batchEvent.data as string) as Record<string, unknown>;

			const batchEventsData = batchData.events as Array<Record<string, unknown>>;
			expect(batchEventsData).toBeDefined();
			expect(batchEventsData.length).toBeGreaterThan(0);

			// Проверяем что есть созданный заказ
			const hasOrderEvent = batchEventsData.some(
				(e) =>
					e.entity_type === 'order' && (e.data_snapshot as Record<string, unknown>).total === 5000
			);
			expect(hasOrderEvent).toBe(true);

			console.log('✅ ASSERTION 5: Batch contains correct order data');
		} finally {
			// Cleanup
			await sseManager.closeConnection(clientA);
			await sseManager.closeConnection(clientB);
		}
	}, 15000); // 15 секунд timeout

	it('Deduplication: один entity обновлён 3 раза = 1 событие в батче', async () => {
		const userId = '00000000-0000-0000-0000-000000000001';
		const testId = `dedup-${Date.now()}`;
		const clientId = testId;

		// Генерируем УНИКАЛЬНЫЙ UUID для каждого запуска теста
		const crypto = await import('crypto');
		const testOrderId = crypto.randomUUID();

		const mockStream = { writeSSE: vi.fn().mockResolvedValue(undefined), close: vi.fn() };

		try {
			await sseManager.createConnection(clientId, userId, mockStream as any);
			await syncManager.subscribeCollection('orders_active', userId, clientId);

			// Ждём подписки
			await new Promise((resolve) => setTimeout(resolve, 100));

			mockStream.writeSSE.mockClear();

			// Обновляем один заказ 3 раза в транзакции
			const client = await pool.connect();

			try {
				await client.query('BEGIN');
				await client.query(`SET LOCAL app.current_user_id = '${userId}'`);

				// Создаём НОВЫЙ заказ (UUID уникальный для теста)
				await client.query(
					`INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status, version)
					 VALUES ($1, $2, 'P-Dedup', 'D-Dedup', 1500, 'pending', 1)`,
					[testOrderId, userId]
				);

				// Обновляем 3 раза
				await client.query(`UPDATE "order" SET status = 'accepted' WHERE id = $1`, [testOrderId]);
				await client.query(`UPDATE "order" SET status = 'in_progress' WHERE id = $1`, [
					testOrderId
				]);
				await client.query(`UPDATE "order" SET status = 'delivering' WHERE id = $1`, [testOrderId]);

				await client.query('SELECT flush_batch_notifications()');
				await client.query('COMMIT');
			} finally {
				client.release();
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));

			// ПРОВЕРКА: Должен быть только ОДИН batch_update
			const batchCalls = mockStream.writeSSE.mock.calls.filter(
				(call: any) => call[0]?.event === 'batch_update'
			);

			expect(batchCalls.length).toBe(1);

			// ПРОВЕРКА: В батче должно быть только ОДНО событие для order (последняя версия)
			const batchData = JSON.parse(batchCalls[0][0].data as string) as Record<string, unknown>;
			const events = batchData.events as Array<Record<string, unknown>>;
			const orderEvents = events.filter(
				(e) => e.entity_type === 'order' && e.entity_id === testOrderId
			);

			// Должно быть ТОЛЬКО 1 событие (дедупликация)
			expect(orderEvents.length).toBe(1);

			// Версия должна быть 4 (1 INSERT + 3 UPDATE)
			expect(orderEvents[0].entity_version).toBe(4);

			// Статус должен быть последний
			expect((orderEvents[0].data_snapshot as Record<string, unknown>).status).toBe('delivering');

			console.log(
				`✅ Deduplication works: 3 updates → 1 event (version ${orderEvents[0].entity_version}, status: delivering)`
			);
		} finally {
			await sseManager.closeConnection(clientId);
		}
	}, 15000);
});
