/**
 * Use Collection Hook
 *
 * Удобный хелпер для использования коллекций в компонентах
 */

import { syncStore } from './sync-store.svelte';

export function useCollection(collectionId: string, params?: Record<string, unknown>) {
	let data = $state<Record<string, unknown>[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Подписка с cleanup через $effect (Svelte 5 best practice)
	$effect(() => {
		let subscribed = false;

		syncStore
			.subscribe(collectionId, params)
			.then((initialData) => {
				data = initialData;
				loading = false;
				subscribed = true;
			})
			.catch((err) => {
				error = err.message;
				loading = false;
			});

		// Cleanup при unmount
		return () => {
			if (subscribed) {
				syncStore.unsubscribe(collectionId);
			}
		};
	});

	// Используем $derived для реактивности вместо getter
	const currentData = $derived(syncStore.getCollection(collectionId));
	const finalData = $derived(currentData.length > 0 ? currentData : data);

	return {
		get data() {
			return finalData;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		}
	};
}
