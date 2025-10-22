/**
 * Unit тесты для Sync Manager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncManager } from '../../../src/lib/server/sync/sync-manager';

// Mock dependencies
vi.mock('../../../src/lib/server/redis', () => ({
	redis: {
		sadd: vi.fn(),
		srem: vi.fn(),
		smembers: vi.fn(() => []),
		keys: vi.fn(() => [])
	},
	RedisKeys: {
		collectionSubscriptions: (cId: string, uId: string) => `cs:${cId}:${uId}`,
		clientCollections: (cId: string) => `cc:${cId}`,
		userClients: (uId: string) => `uc:${uId}`,
		collectionCache: (cId: string, uId: string) => `cache:${cId}:${uId}`
	}
}));

vi.mock('../../../src/lib/server/db/pool', () => ({
	pool: {
		connect: vi.fn(() => ({
			query: vi.fn(),
			release: vi.fn()
		}))
	},
	setUserContext: vi.fn(),
	setClientIdContext: vi.fn()
}));

describe('SyncManager', () => {
	let syncManager: SyncManager;

	beforeEach(() => {
		syncManager = new SyncManager();
		vi.clearAllMocks();
	});

	describe('subscribeCollection', () => {
		it('должен добавить клиента в Redis subscriptions', async () => {
			const { redis } = await import('../../../src/lib/server/redis');

			await syncManager.subscribeCollection('orders_active', 'user-123', 'client-abc');

			expect(redis.sadd).toHaveBeenCalledWith('cs:orders_active:user-123', 'client-abc');
			expect(redis.sadd).toHaveBeenCalledWith('cc:client-abc', 'orders_active:user-123');
		});

		it('должен корректно обрабатывать параметризованные коллекции', async () => {
			const { redis } = await import('../../../src/lib/server/redis');

			await syncManager.subscribeCollection('chat_messages:*', 'user-123', 'client-abc', {
				param: 'chat-456'
			});

			expect(redis.sadd).toHaveBeenCalledWith('cs:chat_messages:chat-456:user-123', 'client-abc');
		});
	});

	describe('unsubscribeCollection', () => {
		it('должен удалить клиента из Redis subscriptions', async () => {
			const { redis } = await import('../../../src/lib/server/redis');

			await syncManager.unsubscribeCollection('orders_active', 'user-123', 'client-abc');

			expect(redis.srem).toHaveBeenCalledWith('cs:orders_active:user-123', 'client-abc');
			expect(redis.srem).toHaveBeenCalledWith('cc:client-abc', 'orders_active:user-123');
		});
	});

	describe('buildQueryWithParams', () => {
		it('должен создать параметризованный SQL для простой коллекции', () => {
			const schema = {
				collection_id: 'orders_active',
				base_table: 'order',
				filter: {
					status: ['pending', 'accepted']
				},
				fields: {
					order: ['id', 'status', 'version']
				},
				cache_strategy: { ttl: 30000, persist_offline: true },
				access_control: { type: 'row_level' as const }
			};

			const { query } = (syncManager as any).buildQueryWithParams(schema, undefined, 'user-123');

			expect(query).toContain('SELECT "order"."id", "order"."status", "order"."version"');
			expect(query).toContain('FROM "order"');
			expect(query).toContain("IN ('pending', 'accepted')");
		});

		it('должен обработать $current_user фильтр', () => {
			const schema = {
				collection_id: 'user_notifications',
				base_table: 'notification',
				filter: {
					user_id: '$current_user'
				},
				fields: {
					notification: ['id', 'message']
				},
				cache_strategy: { ttl: 10000, persist_offline: true },
				access_control: { type: 'implicit' as const, owner_field: 'user_id' }
			};

			const { query, queryParams } = (syncManager as any).buildQueryWithParams(
				schema,
				undefined,
				'user-789'
			);

			expect(query).toContain('"notification"."user_id" = $1');
			expect(queryParams).toContain('user-789');
		});

		it('должен обработать параметризованную коллекцию', () => {
			const schema = {
				collection_id: 'chat_messages',
				base_table: 'message',
				filter: {
					chat_id: '$param'
				},
				fields: {
					message: ['id', 'text']
				},
				cache_strategy: { ttl: 60000, persist_offline: true },
				access_control: { type: 'custom' as const }
			};

			const { query, queryParams } = (syncManager as any).buildQueryWithParams(
				schema,
				{ param: 'chat-123' },
				'user-456'
			);

			expect(query).toContain('"message"."chat_id" = $1');
			expect(queryParams).toContain('chat-123');
		});
	});

	describe('calculateDiff', () => {
		it('должен определить new entities', () => {
			const serverData = [
				{ id: 'order-1', status: 'pending', version: 1 },
				{ id: 'order-2', status: 'accepted', version: 1 }
			];

			const stateVector = {};

			const schema = {
				collection_id: 'orders_active',
				base_table: 'order',
				fields: { order: ['id', 'status', 'version'] },
				cache_strategy: { ttl: 30000, persist_offline: true },
				access_control: { type: 'row_level' as const }
			};

			const diff = (syncManager as any).calculateDiff(serverData, stateVector, schema);

			expect(diff.new).toHaveLength(2);
			expect(diff.updated).toHaveLength(0);
			expect(diff.removed).toHaveLength(0);
		});

		it('должен определить updated entities', () => {
			const serverData = [{ id: 'order-1', status: 'accepted', version: 3 }];

			const stateVector = {
				'order:order-1': { version: 1 }
			};

			const schema = {
				collection_id: 'orders_active',
				base_table: 'order',
				fields: { order: ['id', 'status', 'version'] },
				cache_strategy: { ttl: 30000, persist_offline: true },
				access_control: { type: 'row_level' as const }
			};

			const diff = (syncManager as any).calculateDiff(serverData, stateVector, schema);

			expect(diff.new).toHaveLength(0);
			expect(diff.updated).toHaveLength(1);
			expect(diff.updated[0].key).toBe('order:order-1');
			expect(diff.updated[0].version).toBe(3);
		});

		it('должен определить removed entities', () => {
			const serverData: any[] = [];

			const stateVector = {
				'order:order-1': { version: 5 },
				'order:order-2': { version: 3 }
			};

			const schema = {
				collection_id: 'orders_active',
				base_table: 'order',
				fields: { order: ['id', 'status'] },
				cache_strategy: { ttl: 30000, persist_offline: true },
				access_control: { type: 'row_level' as const }
			};

			const diff = (syncManager as any).calculateDiff(serverData, stateVector, schema);

			expect(diff.new).toHaveLength(0);
			expect(diff.updated).toHaveLength(0);
			expect(diff.removed).toHaveLength(2);
			expect(diff.removed).toContain('order:order-1');
			expect(diff.removed).toContain('order:order-2');
		});

		it('должен определить unchanged entities', () => {
			const serverData = [{ id: 'order-1', status: 'pending', version: 5 }];

			const stateVector = {
				'order:order-1': { version: 5 }
			};

			const schema = {
				collection_id: 'orders_active',
				base_table: 'order',
				fields: { order: ['id', 'status', 'version'] },
				cache_strategy: { ttl: 30000, persist_offline: true },
				access_control: { type: 'row_level' as const }
			};

			const diff = (syncManager as any).calculateDiff(serverData, stateVector, schema);

			expect(diff.new).toHaveLength(0);
			expect(diff.updated).toHaveLength(0);
			expect(diff.unchanged).toHaveLength(1);
			expect(diff.unchanged[0]).toBe('order:order-1');
		});
	});
});
