/**
 * Unit тесты для Batch Update Handler
 *
 * КРИТИЧНЫЙ ТЕСТ: Проверка initiator exclusion
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchUpdateHandler } from '../../../src/lib/server/sync/batch-handler';

// Mock SSE Manager
const mockSendToClient = vi.fn();
vi.mock('../../../src/lib/server/sync/sse-manager', () => ({
	sseManager: {
		sendToClient: mockSendToClient
	}
}));

// Mock Redis
const mockSmembers = vi.fn();
vi.mock('../../../src/lib/server/redis', () => ({
	redis: {
		smembers: mockSmembers
	},
	RedisKeys: {
		userClients: (userId: string) => `uc:${userId}`,
		clientCollections: (clientId: string) => `cc:${clientId}`
	}
}));

describe('BatchUpdateHandler', () => {
	let batchHandler: BatchUpdateHandler;

	beforeEach(() => {
		batchHandler = new BatchUpdateHandler();
		vi.clearAllMocks();
	});

	describe('handleBatch - Initiator Exclusion', () => {
		it('должен ИСКЛЮЧИТЬ initiator из SSE рассылки', async () => {
			const payload = JSON.stringify({
				tx_id: 'tx-123',
				events: [
					{
						entity_type: 'order',
						entity_id: 'order-1',
						entity_version: 2,
						affected_collections: ['orders_active'],
						affected_users: ['user-1'],
						data_snapshot: { id: 'order-1', status: 'accepted' }
					}
				],
				timestamp: Date.now(),
				initiator_client_id: 'client-abc', // ⭐ ИНИЦИАТОР
				event_count: 1
			});

			// User-1 имеет два клиента
			mockSmembers.mockResolvedValue(['client-abc', 'client-xyz']);

			await batchHandler.handleBatch(payload);

			// Проверяем что sendToClient вызван ТОЛЬКО для client-xyz
			expect(mockSendToClient).toHaveBeenCalledTimes(1);
			expect(mockSendToClient).toHaveBeenCalledWith(
				'client-xyz', // НЕ client-abc!
				expect.objectContaining({
					type: 'batch_update'
				})
			);
		});

		it('должен отправить всем клиентам если нет initiator', async () => {
			const payload = JSON.stringify({
				tx_id: 'tx-456',
				events: [
					{
						entity_type: 'notification',
						entity_id: 'notif-1',
						entity_version: 1,
						affected_collections: ['user_notifications'],
						affected_users: ['user-1'],
						data_snapshot: { id: 'notif-1', message: 'New notification' }
					}
				],
				timestamp: Date.now(),
				initiator_client_id: null, // Нет инициатора
				event_count: 1
			});

			mockSmembers.mockResolvedValue(['client-abc', 'client-xyz']);

			await batchHandler.handleBatch(payload);

			// Оба клиента должны получить
			expect(mockSendToClient).toHaveBeenCalledTimes(2);
		});
	});

	describe('buildClientBatches - Deduplication', () => {
		it('должен дедуплицировать события для одного entity', async () => {
			// Симулируем что один entity обновлён 3 раза в батче
			const events = [
				{
					entity_type: 'user',
					entity_id: 'user-1',
					entity_version: 2,
					affected_collections: ['user_profile'],
					affected_users: ['user-1'],
					data_snapshot: { id: 'user-1', nickname: 'Name v2' }
				},
				{
					entity_type: 'user',
					entity_id: 'user-1',
					entity_version: 3,
					affected_collections: ['user_profile'],
					affected_users: ['user-1'],
					data_snapshot: { id: 'user-1', nickname: 'Name v3' }
				},
				{
					entity_type: 'user',
					entity_id: 'user-1',
					entity_version: 4,
					affected_collections: ['user_profile'],
					affected_users: ['user-1'],
					data_snapshot: { id: 'user-1', nickname: 'Name v4' }
				}
			];

			mockSmembers.mockResolvedValue(['client-xyz']);

			const clientBatches = await (batchHandler as any).buildClientBatches(events);

			// Должен быть только ОДИН event для client-xyz (последняя версия)
			const clientEvents = clientBatches.get('client-xyz');
			expect(clientEvents).toHaveLength(1);
			expect(clientEvents[0].entity_version).toBe(4);
			expect(clientEvents[0].data_snapshot.nickname).toBe('Name v4');
		});
	});

	describe('chunkEvents', () => {
		it('должен НЕ разбивать маленькие батчи', () => {
			const events = new Array(50).fill({ entity_type: 'test' });

			const chunks = (batchHandler as any).chunkEvents(events);

			expect(chunks).toHaveLength(1);
			expect(chunks[0]).toHaveLength(50);
		});

		it('должен разбить большие батчи на чанки по 100', () => {
			const events = new Array(250).fill({ entity_type: 'test' });

			const chunks = (batchHandler as any).chunkEvents(events);

			expect(chunks).toHaveLength(3);
			expect(chunks[0]).toHaveLength(100);
			expect(chunks[1]).toHaveLength(100);
			expect(chunks[2]).toHaveLength(50);
		});
	});
});
