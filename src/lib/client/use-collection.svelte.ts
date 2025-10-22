/**
 * Use Collection Hook
 *
 * Удобный хелпер для использования коллекций в компонентах
 */

import { syncStore } from './sync-store.svelte';
import { onDestroy } from 'svelte';

export function useCollection(collectionId: string, params?: Record<string, unknown>) {
	let data = $state<Record<string, unknown>[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let subscribed = false;

	// Подписка
	$effect(() => {
		if (!subscribed) {
			subscribed = true;

			syncStore
				.subscribe(collectionId, params)
				.then((initialData) => {
					data = initialData;
					loading = false;
				})
				.catch((err) => {
					error = err.message;
					loading = false;
				});
		}
	});

	// Отписка при unmount
	onDestroy(() => {
		if (subscribed) {
			syncStore.unsubscribe(collectionId);
		}
	});

	// Reactive getter
	const getData = () => {
		const currentData = syncStore.getCollection(collectionId);
		if (currentData.length > 0) {
			data = currentData;
		}
		return data;
	};

	return {
		get data() {
			return getData();
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		}
	};
}
