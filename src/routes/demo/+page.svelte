<script lang="ts">
	/**
	 * DEMO страница для тестирования системы синхронизации
	 *
	 * Демонстрирует:
	 * - Подключение к SSE
	 * - Подписку на коллекции
	 * - Real-time обновления
	 * - Offline support
	 */

	import { onMount, onDestroy } from 'svelte';
	import { syncStore } from '$lib/client/sync-store.svelte';

	interface StatsData {
		sse?: {
			totalConnections: number;
			uniqueUsers: number;
			avgConnectionsPerUser: number;
		};
		subscriptions?: {
			totalSubscriptions: number;
			uniqueCollections: number;
			uniqueUsers: number;
		};
	}

	let isInitialized = $state(false);
	let userId = $state('00000000-0000-0000-0000-000000000001'); // Demo UUID
	let collections = $state<string[]>([]);
	let stats = $state<StatsData | null>(null);

	onMount(async () => {
		try {
			await syncStore.init(userId);
			isInitialized = true;
			console.log('✅ Sync initialized');

			// Загружаем stats
			loadStats();
		} catch (error) {
			console.error('Failed to initialize sync:', error);
		}
	});

	onDestroy(async () => {
		await syncStore.destroy();
	});

	async function subscribeToCollection(collectionId: string) {
		try {
			// Проверяем на дубликаты
			if (collections.includes(collectionId)) {
				console.warn(`Already subscribed to ${collectionId}`);
				return;
			}

			const data = await syncStore.subscribe(collectionId);
			console.log(`Subscribed to ${collectionId}:`, data);
			collections = [...collections, collectionId];
		} catch (error) {
			console.error('Subscription failed:', error);
		}
	}

	async function unsubscribeFromCollection(collectionId: string) {
		try {
			await syncStore.unsubscribe(collectionId);
			collections = collections.filter((c) => c !== collectionId);
			console.log(`Unsubscribed from ${collectionId}`);
		} catch (error) {
			console.error('Unsubscription failed:', error);
		}
	}

	async function loadStats() {
		try {
			const response = await fetch('/api/sync/stats', {
				headers: {
					Authorization: 'Bearer demo-session-token'
				}
			});
			stats = await response.json();
		} catch (error) {
			console.error('Failed to load stats:', error);
		}
	}
</script>

<div class="demo-page">
	<header>
		<h1>🔄 Real-Time Sync System Demo</h1>
		<p>Демонстрация системы синхронизации данных в реальном времени</p>
	</header>

	<div class="status">
		<div class="status-item" class:active={isInitialized}>
			<span class="indicator"></span>
			<span>SSE Connection: {isInitialized ? 'Connected' : 'Disconnected'}</span>
		</div>
		<div class="status-item">
			<span>User ID: {userId}</span>
		</div>
		<div class="status-item">
			<span>Active Collections: {collections.length}</span>
		</div>
	</div>

	<section class="controls">
		<h2>Управление подписками</h2>

		<div class="buttons">
			<button onclick={() => subscribeToCollection('orders_active')}>
				📦 Subscribe to Active Orders
			</button>
			<button onclick={() => subscribeToCollection('user_notifications')}>
				🔔 Subscribe to Notifications
			</button>
			<button onclick={() => subscribeToCollection('chats_my')}> 💬 Subscribe to My Chats </button>
		</div>

		{#if collections.length > 0}
			<div class="subscriptions">
				<h3>Активные подписки:</h3>
				<ul>
					{#each collections as collection (collection)}
						<li>
							<span>{collection}</span>
							<button onclick={() => unsubscribeFromCollection(collection)}> Отписаться </button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>

	{#if stats}
		<section class="stats">
			<h2>Статистика</h2>
			<div class="stats-grid">
				<div class="stat-card">
					<h3>SSE Connections</h3>
					<p class="stat-value">{stats.sse?.totalConnections || 0}</p>
					<p class="stat-label">Всего соединений</p>
				</div>
				<div class="stat-card">
					<h3>Unique Users</h3>
					<p class="stat-value">{stats.sse?.uniqueUsers || 0}</p>
					<p class="stat-label">Уникальных пользователей</p>
				</div>
				<div class="stat-card">
					<h3>Subscriptions</h3>
					<p class="stat-value">{stats.subscriptions?.totalSubscriptions || 0}</p>
					<p class="stat-label">Всего подписок</p>
				</div>
				<div class="stat-card">
					<h3>Collections</h3>
					<p class="stat-value">{stats.subscriptions?.uniqueCollections || 0}</p>
					<p class="stat-label">Уникальных коллекций</p>
				</div>
			</div>
			<button onclick={loadStats}>🔄 Обновить статистику</button>
		</section>
	{/if}

	<section class="info">
		<h2>ℹ️ Информация</h2>
		<p>Эта страница демонстрирует работу системы синхронизации данных в реальном времени.</p>
		<ul>
			<li>SSE соединение устанавливается автоматически при загрузке</li>
			<li>Подписки на коллекции регистрируются в Redis</li>
			<li>Изменения данных поступают через SSE в реальном времени</li>
			<li>Данные кэшируются в IndexedDB для offline работы</li>
		</ul>
	</section>
</div>

<style>
	.demo-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	header {
		text-align: center;
		margin-bottom: 3rem;
	}

	header h1 {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
	}

	header p {
		color: #666;
		font-size: 1.125rem;
	}

	.status {
		display: flex;
		gap: 2rem;
		padding: 1.5rem;
		background: #f8f9fa;
		border-radius: 8px;
		margin-bottom: 2rem;
		flex-wrap: wrap;
	}

	.status-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.status-item.active .indicator {
		background: #28a745;
	}

	.indicator {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #dc3545;
	}

	section {
		margin-bottom: 3rem;
		padding: 2rem;
		background: white;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
	}

	h2 {
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.buttons {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 2rem;
	}

	button {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 4px;
		background: #007bff;
		color: white;
		cursor: pointer;
		font-size: 1rem;
		transition: background 0.2s;
	}

	button:hover {
		background: #0056b3;
	}

	.subscriptions {
		margin-top: 2rem;
	}

	.subscriptions ul {
		list-style: none;
		padding: 0;
	}

	.subscriptions li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: #f8f9fa;
		margin-bottom: 0.5rem;
		border-radius: 4px;
	}

	.subscriptions li button {
		padding: 0.5rem 1rem;
		background: #dc3545;
		font-size: 0.875rem;
	}

	.subscriptions li button:hover {
		background: #c82333;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.stat-card {
		padding: 1.5rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		border-radius: 8px;
		text-align: center;
	}

	.stat-card h3 {
		font-size: 0.875rem;
		opacity: 0.9;
		margin-bottom: 0.5rem;
	}

	.stat-value {
		font-size: 2.5rem;
		font-weight: bold;
		margin: 0.5rem 0;
	}

	.stat-label {
		font-size: 0.75rem;
		opacity: 0.8;
		margin: 0;
	}

	.info ul {
		line-height: 1.8;
	}
</style>
