/**
 * Client Sync Manager
 *
 * Управление синхронизацией на клиенте:
 * - Двухуровневый кэш (runtime + IndexedDB)
 * - SSE подключение
 * - Differential sync
 * - Offline support
 */

import { openDB, type IDBPDatabase } from 'idb';
import { getCollectionSchema } from '$lib/collections.schema';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

interface DiffItem {
	key: string;
	version: number;
	data: Record<string, unknown>;
}

interface DiffResult {
	new?: DiffItem[];
	updated?: DiffItem[];
	unchanged?: string[];
	removed?: string[];
}

interface BatchEvent {
	entity_type: string;
	entity_id: string;
	entity_version: number;
	data_snapshot: Record<string, unknown>;
	affected_collections: string[];
}

export class ClientSyncManager {
	private runtime = $state(new SvelteMap<string, Record<string, unknown>>());
	private db: IDBPDatabase | null = $state(null);
	private clientId: string;
	private userId: string;
	private eventSource: EventSource | null = $state(null);
	private activeCollections = $state(new SvelteSet<string>());
	private listeners = new SvelteMap<string, Set<(...args: unknown[]) => void>>();

	constructor(userId: string) {
		this.userId = userId;
		this.clientId = this.generateClientId();
	}

	/**
	 * Инициализация
	 */
	async init() {
		// Открываем IndexedDB
		this.db = await openDB('app-sync', 1, {
			upgrade(db) {
				const entityStore = db.createObjectStore('entities', { keyPath: 'key' });
				entityStore.createIndex('by-collection', 'collection_id');
				entityStore.createIndex('by-cached-at', 'cached_at');

				db.createObjectStore('collections', { keyPath: 'collection_id' });
			}
		});

		// Подключаем SSE
		this.connectSSE();

		console.log(`✅ Client Sync Manager initialized (${this.clientId})`);
	}

	/**
	 * Подключиться к SSE
	 */
	private connectSSE() {
		const sessionToken = this.getSessionToken();
		if (!sessionToken) {
			console.error('No session token found');
			return;
		}

		// EventSource не поддерживает custom headers, передаем token через query
		const url = `/api/sync/events?client_id=${this.clientId}&token=${sessionToken}`;

		this.eventSource = new EventSource(url);

		this.eventSource.addEventListener('connected', (event) => {
			const data = JSON.parse(event.data);
			console.log('✅ SSE connected:', data);
		});

		this.eventSource.addEventListener('batch_update', (event) => {
			const batch = JSON.parse(event.data);
			this.handleBatchUpdate(batch);
		});

		this.eventSource.addEventListener('access_revoked', () => {
			this.handleAccessRevoked();
		});

		this.eventSource.onerror = () => {
			console.error('❌ SSE error, reconnecting...');
			this.eventSource?.close();
			setTimeout(() => this.connectSSE(), 5000);
		};
	}

	/**
	 * Подписаться на коллекцию
	 */
	async subscribeCollection(
		collectionId: string,
		params?: Record<string, unknown>
	): Promise<Record<string, unknown>[]> {
		const schema = getCollectionSchema(collectionId);
		if (!schema) {
			throw new Error(`Unknown collection: ${collectionId}`);
		}

		console.log(`📡 Subscribing to ${collectionId}...`);

		// Регистрируем подписку на сервере
		await this.makeRequest('/api/sync/subscribe', {
			method: 'POST',
			body: JSON.stringify({
				collection_id: collectionId,
				client_id: this.clientId,
				params
			})
		});

		// Добавляем в активные
		this.activeCollections.add(collectionId);

		// Загружаем данные
		return await this.loadCollection(collectionId, params);
	}

	/**
	 * Отписаться от коллекции
	 */
	async unsubscribeCollection(collectionId: string) {
		await this.makeRequest('/api/sync/unsubscribe', {
			method: 'POST',
			body: JSON.stringify({
				collection_id: collectionId,
				client_id: this.clientId
			})
		});

		this.activeCollections.delete(collectionId);
		console.log(`🔇 Unsubscribed from ${collectionId}`);
	}

	/**
	 * Загрузить коллекцию с differential sync
	 */
	private async loadCollection(
		collectionId: string,
		params?: Record<string, unknown>
	): Promise<Record<string, unknown>[]> {
		// Собираем state vector из кэша
		const stateVector = await this.buildStateVector(collectionId);

		console.log(
			`🔄 Fetching ${collectionId} with ${Object.keys(stateVector).length} cached entities`
		);

		// Differential sync запрос
		const response = await this.makeRequest('/api/sync', {
			method: 'POST',
			body: JSON.stringify({
				collection_id: collectionId,
				state_vector: stateVector,
				params
			})
		});

		const diff = await response.json();

		console.log(
			`   📊 Diff: ${diff.new?.length || 0} new, ${diff.updated?.length || 0} updated, ${diff.removed?.length || 0} removed`
		);

		// Применяем diff
		await this.applyDiff(collectionId, diff);

		// Возвращаем данные из кэша
		return await this.getCachedCollectionData(collectionId);
	}

	/**
	 * Построить state vector для differential sync
	 */
	private async buildStateVector(
		collectionId: string
	): Promise<Record<string, { version: number }>> {
		if (!this.db) return {};

		const stateVector: Record<string, { version: number }> = {};

		const tx = this.db.transaction('entities', 'readonly');
		const index = tx.store.index('by-collection');
		const entities = await index.getAll(collectionId);

		for (const entity of entities) {
			stateVector[entity.key] = { version: entity.version };
		}

		return stateVector;
	}

	/**
	 * Применить diff к кэшу
	 */
	private async applyDiff(collectionId: string, diff: DiffResult) {
		if (!this.db) return;

		const tx = this.db.transaction(['entities', 'collections'], 'readwrite');
		const entityKeys: string[] = [];

		// New entities
		for (const item of diff.new || []) {
			await tx.objectStore('entities').put({
				key: item.key,
				data: item.data,
				version: item.version,
				cached_at: Date.now(),
				collection_id: collectionId
			});

			entityKeys.push(item.key);
			this.runtime.set(item.key, item.data);
		}

		// Updated entities
		for (const item of diff.updated || []) {
			await tx.objectStore('entities').put({
				key: item.key,
				data: item.data,
				version: item.version,
				cached_at: Date.now(),
				collection_id: collectionId
			});

			entityKeys.push(item.key);
			this.runtime.set(item.key, item.data);
		}

		// Unchanged - обновляем timestamp
		for (const key of diff.unchanged || []) {
			const entity = await tx.objectStore('entities').get(key);
			if (entity) {
				entity.cached_at = Date.now();
				await tx.objectStore('entities').put(entity);
				entityKeys.push(key);
			}
		}

		// Removed
		for (const key of diff.removed || []) {
			await tx.objectStore('entities').delete(key);
			this.runtime.delete(key);
		}

		// Обновляем metadata коллекции
		await tx.objectStore('collections').put({
			collection_id: collectionId,
			cached_at: Date.now(),
			entities: entityKeys
		});

		await tx.done;

		// Уведомляем подписчиков
		this.emit('collection_updated', { collectionId });
	}

	/**
	 * Получить данные коллекции из кэша (публичный метод для store)
	 */
	async getCachedCollectionData(collectionId: string): Promise<Record<string, unknown>[]> {
		if (!this.db) return [];

		const collection = await this.db.get('collections', collectionId);
		if (!collection) return [];

		const data: Record<string, unknown>[] = [];
		for (const key of collection.entities) {
			// Сначала проверяем runtime кэш
			const cached = this.runtime.get(key);
			if (cached) {
				data.push(cached);
			} else {
				const entity = await this.db.get('entities', key);
				if (entity) {
					data.push(entity.data);
					this.runtime.set(key, entity.data);
				}
			}
		}

		return data;
	}

	/**
	 * Обработать batch update от SSE
	 */
	private async handleBatchUpdate(batch: Record<string, unknown>) {
		const { tx_id, events, timestamp } = batch as {
			tx_id: string;
			events: BatchEvent[];
			timestamp: number;
		};

		console.log(`📦 Applying batch ${tx_id} with ${events.length} events`);

		const affectedCollections = new SvelteSet<string>();

		for (const event of events) {
			const {
				entity_type,
				entity_id,
				entity_version,
				data_snapshot,
				affected_collections: eventCollections
			} = event;
			const entityKey = `${entity_type}:${entity_id}`;

			// Обновляем entity для всех затронутых коллекций
			for (const collectionId of eventCollections) {
				if (this.activeCollections.has(collectionId)) {
					if (this.db) {
						await this.db.put('entities', {
							key: entityKey,
							data: data_snapshot,
							version: entity_version,
							cached_at: timestamp,
							collection_id: collectionId
						});
					}

					this.runtime.set(entityKey, data_snapshot);
					affectedCollections.add(collectionId);
				}
			}
		}

		// Уведомляем UI об обновлениях
		for (const collectionId of affectedCollections) {
			this.emit('collection_updated', { collectionId, tx_id });
		}
	}

	/**
	 * Обработать отзыв доступа
	 */
	private async handleAccessRevoked() {
		console.warn('🚫 Access revoked, clearing cache...');

		if (this.db) {
			await this.db.clear('entities');
			await this.db.clear('collections');
		}

		this.runtime.clear();

		// Перезагружаем активные коллекции
		for (const collectionId of this.activeCollections) {
			await this.loadCollection(collectionId);
		}
	}

	/**
	 * HTTP запрос с авторизацией и client_id
	 */
	private async makeRequest(url: string, options: RequestInit = {}): Promise<Response> {
		const sessionToken = this.getSessionToken();

		return fetch(url, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${sessionToken}`,
				'X-Client-Id': this.clientId,
				...options.headers
			},
			credentials: 'include'
		});
	}

	/**
	 * Получить session token (заглушка)
	 */
	private getSessionToken(): string | null {
		// В реальном приложении получать из cookie или localStorage
		return 'demo-session-token';
	}

	/**
	 * Генерировать client ID
	 */
	private generateClientId(): string {
		return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Event emitter
	 */
	on(event: string, callback: (...args: unknown[]) => void) {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new SvelteSet<(...args: unknown[]) => void>());
		}
		this.listeners.get(event)!.add(callback);
	}

	off(event: string, callback: (...args: unknown[]) => void) {
		this.listeners.get(event)?.delete(callback);
	}

	private emit(event: string, data: unknown) {
		const callbacks = this.listeners.get(event);
		if (callbacks) {
			callbacks.forEach((cb) => cb(data));
		}
	}

	/**
	 * Cleanup
	 */
	async destroy() {
		this.eventSource?.close();
		this.db?.close();
		console.log('👋 Client Sync Manager destroyed');
	}
}
