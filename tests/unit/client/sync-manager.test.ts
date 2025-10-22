/**
 * Unit тесты для Client Sync Manager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClientSyncManager } from '../../../src/lib/client/sync-manager.svelte';

// Mock IndexedDB
import 'fake-indexeddb/auto';

// Mock fetch
global.fetch = vi.fn();

describe('ClientSyncManager', () => {
	let syncManager: ClientSyncManager;

	beforeEach(() => {
		syncManager = new ClientSyncManager('user-test-123');
		vi.clearAllMocks();
	});

	describe('generateClientId', () => {
		it('должен создать уникальный ID', () => {
			const clientId1 = (syncManager as any).generateClientId();
			const clientId2 = (syncManager as any).generateClientId();

			expect(clientId1).toMatch(/^client_\d+_[a-z0-9]+$/);
			expect(clientId2).toMatch(/^client_\d+_[a-z0-9]+$/);
			expect(clientId1).not.toBe(clientId2);
		});
	});

	describe('buildStateVector', () => {
		it('должен построить state vector из IndexedDB', async () => {
			await syncManager.init();

			// Добавляем тестовые данные в IndexedDB
			const db = (syncManager as any).db;
			await db.put('entities', {
				key: 'order:order-1',
				data: { id: 'order-1', status: 'pending' },
				version: 5,
				cached_at: Date.now(),
				collection_id: 'orders_active'
			});

			await db.put('entities', {
				key: 'order:order-2',
				data: { id: 'order-2', status: 'accepted' },
				version: 3,
				cached_at: Date.now(),
				collection_id: 'orders_active'
			});

			const stateVector = await (syncManager as any).buildStateVector('orders_active');

			expect(stateVector).toEqual({
				'order:order-1': { version: 5 },
				'order:order-2': { version: 3 }
			});
		});
	});

	describe('applyDiff', () => {
		it('должен применить new entities к кэшу', async () => {
			await syncManager.init();

			const diff = {
				new: [
					{
						key: 'order:order-new',
						version: 1,
						data: { id: 'order-new', status: 'pending' }
					}
				],
				updated: [],
				unchanged: [],
				removed: []
			};

			await (syncManager as any).applyDiff('orders_active', diff);

			// Проверяем IndexedDB
			const db = (syncManager as any).db;
			const entity = await db.get('entities', 'order:order-new');

			expect(entity).toBeDefined();
			expect(entity.version).toBe(1);
			expect(entity.data.status).toBe('pending');

			// Проверяем runtime cache
			const runtime = (syncManager as any).runtime;
			expect(runtime.get('order:order-new')).toEqual({ id: 'order-new', status: 'pending' });
		});

		it('должен обновить existing entities', async () => {
			await syncManager.init();

			const db = (syncManager as any).db;

			// Добавляем старую версию
			await db.put('entities', {
				key: 'order:order-1',
				data: { id: 'order-1', status: 'pending' },
				version: 1,
				cached_at: Date.now(),
				collection_id: 'orders_active'
			});

			const diff = {
				new: [],
				updated: [
					{
						key: 'order:order-1',
						version: 2,
						data: { id: 'order-1', status: 'accepted' }
					}
				],
				unchanged: [],
				removed: []
			};

			await (syncManager as any).applyDiff('orders_active', diff);

			const entity = await db.get('entities', 'order:order-1');

			expect(entity.version).toBe(2);
			expect(entity.data.status).toBe('accepted');
		});

		it('должен удалить removed entities', async () => {
			await syncManager.init();

			const db = (syncManager as any).db;

			// Добавляем entity
			await db.put('entities', {
				key: 'order:order-old',
				data: { id: 'order-old' },
				version: 1,
				cached_at: Date.now(),
				collection_id: 'orders_active'
			});

			const diff = {
				new: [],
				updated: [],
				unchanged: [],
				removed: ['order:order-old']
			};

			await (syncManager as any).applyDiff('orders_active', diff);

			const entity = await db.get('entities', 'order:order-old');
			expect(entity).toBeUndefined();

			// Проверяем runtime
			const runtime = (syncManager as any).runtime;
			expect(runtime.has('order:order-old')).toBe(false);
		});
	});

	describe('makeRequest', () => {
		it('должен добавить X-Client-Id header', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => ({})
			});

			await (syncManager as any).makeRequest('/api/test', {
				method: 'POST',
				body: JSON.stringify({ test: true })
			});

			expect(global.fetch).toHaveBeenCalledWith(
				'/api/test',
				expect.objectContaining({
					headers: expect.objectContaining({
						'X-Client-Id': expect.stringMatching(/^client_/)
					})
				})
			);
		});

		it('должен добавить Authorization header', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => ({})
			});

			await (syncManager as any).makeRequest('/api/test');

			expect(global.fetch).toHaveBeenCalledWith(
				'/api/test',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: expect.stringContaining('Bearer')
					})
				})
			);
		});
	});
});
