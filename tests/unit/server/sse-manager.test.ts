/**
 * Unit тесты для SSE Manager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SSEManager } from '../../../src/lib/server/sync/sse-manager';

// Mock Redis
const mockSadd = vi.fn();
const mockSrem = vi.fn();
const mockSmembers = vi.fn<() => Promise<string[]>>(() => Promise.resolve([]));
const mockDel = vi.fn();

vi.mock('../../../src/lib/server/redis', () => ({
	redis: {
		sadd: mockSadd,
		srem: mockSrem,
		smembers: mockSmembers,
		del: mockDel
	},
	RedisKeys: {
		userClients: (userId: string) => `uc:${userId}`,
		clientCollections: (clientId: string) => `cc:${clientId}`,
		collectionSubscriptions: (cId: string, uId: string) => `cs:${cId}:${uId}`
	}
}));

describe('SSEManager', () => {
	let sseManager: SSEManager;
	let mockStream: any;

	beforeEach(() => {
		sseManager = new SSEManager();
		mockStream = {
			writeSSE: vi.fn(),
			close: vi.fn()
		};
		vi.clearAllMocks();
	});

	afterEach(() => {
		sseManager.stopHeartbeat();
	});

	describe('createConnection', () => {
		it('должен зарегистрировать SSE соединение', async () => {
			await sseManager.createConnection('client-123', 'user-456', mockStream as any);

			const connection = sseManager.getConnection('client-123');

			expect(connection).toBeDefined();
			expect(connection?.clientId).toBe('client-123');
			expect(connection?.userId).toBe('user-456');
		});

		it('должен добавить клиента в Redis user_clients', async () => {
			await sseManager.createConnection('client-123', 'user-456', mockStream);

			expect(mockSadd).toHaveBeenCalledWith('uc:user-456', 'client-123');
		});

		it('должен отправить connected событие', async () => {
			await sseManager.createConnection('client-123', 'user-456', mockStream);

			expect(mockStream.writeSSE).toHaveBeenCalledWith(
				expect.objectContaining({
					event: 'connected',
					data: expect.stringContaining('client-123')
				})
			);
		});
	});

	describe('sendToClient', () => {
		beforeEach(async () => {
			await sseManager.createConnection('client-123', 'user-456', mockStream);
		});

		it('должен отправить SSE событие', async () => {
			const result = await sseManager.sendToClient('client-123', {
				type: 'batch_update',
				data: { tx_id: 'tx-789' }
			});

			expect(result).toBe(true);
			expect(mockStream.writeSSE).toHaveBeenCalledWith({
				event: 'batch_update',
				data: JSON.stringify({ tx_id: 'tx-789' })
			});
		});

		it('должен вернуть false для несуществующего клиента', async () => {
			const result = await sseManager.sendToClient('non-existent', {
				type: 'test',
				data: {}
			});

			expect(result).toBe(false);
		});

		it('должен закрыть соединение при ошибке отправки', async () => {
			mockStream.writeSSE.mockRejectedValueOnce(new Error('Stream error'));

			const result = await sseManager.sendToClient('client-123', {
				type: 'test',
				data: {}
			});

			expect(result).toBe(false);
			// Соединение должно быть удалено
			expect(sseManager.getConnection('client-123')).toBeUndefined();
		});
	});

	describe('closeConnection', () => {
		beforeEach(async () => {
			await sseManager.createConnection('client-123', 'user-456', mockStream as any);
			mockSmembers.mockResolvedValue(['orders_active:user-456', 'user_notifications:user-456']);
		});

		it('должен удалить все подписки клиента', async () => {
			await sseManager.closeConnection('client-123');

			// Проверяем что удалились подписки на коллекции
			expect(mockSrem).toHaveBeenCalledWith('cs:orders_active:user-456', 'client-123');
			expect(mockSrem).toHaveBeenCalledWith('cs:user_notifications:user-456', 'client-123');
		});

		it('должен удалить из user_clients', async () => {
			await sseManager.closeConnection('client-123');

			expect(mockSrem).toHaveBeenCalledWith('uc:user-456', 'client-123');
		});

		it('должен удалить client_collections', async () => {
			await sseManager.closeConnection('client-123');

			expect(mockDel).toHaveBeenCalledWith('cc:client-123');
		});

		it('должен закрыть SSE stream', async () => {
			await sseManager.closeConnection('client-123');

			expect(mockStream.close).toHaveBeenCalled();
		});
	});

	describe('getStats', () => {
		it('должен вернуть правильную статистику', async () => {
			await sseManager.createConnection('client-1', 'user-1', mockStream);
			await sseManager.createConnection('client-2', 'user-1', mockStream);
			await sseManager.createConnection('client-3', 'user-2', mockStream);

			const stats = sseManager.getStats();

			expect(stats.totalConnections).toBe(3);
			expect(stats.uniqueUsers).toBe(2);
			expect(stats.avgConnectionsPerUser).toBe(1.5);
		});
	});
});
