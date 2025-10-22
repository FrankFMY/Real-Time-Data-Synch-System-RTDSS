/**
 * Sync Store
 *
 * Svelte runes совместимый store для работы с синхронизацией
 */

import { ClientSyncManager } from './sync-manager.svelte';

class SyncStore {
	manager = $state<ClientSyncManager | null>(null);
	isInitialized = $state(false);
	collections = $state(new Map<string, Record<string, unknown>[]>());

	/**
	 * Инициализировать sync manager
	 */
	async init(userId: string) {
		if (this.isInitialized) {
			console.warn('Sync already initialized');
			return;
		}

		this.manager = new ClientSyncManager(userId);
		await this.manager.init();

		// Слушаем обновления коллекций
		this.manager.on('collection_updated', (payload: unknown) => {
			const { collectionId } = payload as { collectionId: string };
			this.refreshCollection(collectionId);
		});

		this.isInitialized = true;
	}

	/**
	 * Подписаться на коллекцию
	 */
	async subscribe(
		collectionId: string,
		params?: Record<string, unknown>
	): Promise<Record<string, unknown>[]> {
		if (!this.manager) {
			throw new Error('Sync not initialized');
		}

		const data = await this.manager.subscribeCollection(collectionId, params);
		this.collections.set(collectionId, data);

		return data;
	}

	/**
	 * Отписаться от коллекции
	 */
	async unsubscribe(collectionId: string) {
		if (!this.manager) return;

		await this.manager.unsubscribeCollection(collectionId);
		this.collections.delete(collectionId);
	}

	/**
	 * Обновить данные коллекции из кэша
	 */
	private async refreshCollection(collectionId: string): Promise<void> {
		if (!this.manager) return;

		const data = await this.manager.getCachedCollectionData(collectionId);
		this.collections.set(collectionId, data);
	}

	/**
	 * Получить данные коллекции (reactive)
	 */
	getCollection(collectionId: string): Record<string, unknown>[] {
		return this.collections.get(collectionId) || [];
	}

	/**
	 * Cleanup
	 */
	async destroy() {
		await this.manager?.destroy();
		this.manager = null;
		this.isInitialized = false;
		this.collections.clear();
	}
}

// Singleton instance
export const syncStore = new SyncStore();
