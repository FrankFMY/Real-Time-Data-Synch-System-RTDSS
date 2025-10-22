<script lang="ts">
	import { useCollection } from '$lib/client/use-collection.svelte';

	interface OrderData {
		id: string;
		status: string;
		total: number;
		pickup_address: string;
		delivery_address: string;
		customer?: {
			nickname: string;
			avatar_url?: string;
		};
		driver?: {
			nickname: string;
		};
	}

	/**
	 * Компонент списка активных заказов с real-time обновлениями
	 */
	const { data, loading, error } = useCollection('orders_active');

	// Типизированный getter с двойным приведением для безопасности
	const orders = $derived(data as unknown as OrderData[]);
</script>

<div class="orders-list">
	<h2>Активные заказы</h2>

	{#if loading}
		<p>Загрузка...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if orders.length === 0}
		<p>Нет активных заказов</p>
	{:else}
		<div class="orders">
			{#each orders as order (order.id)}
				<div class="order-card">
					<div class="order-header">
						<span class="order-id">#{order.id.toString().slice(0, 8)}</span>
						<span
							class="order-status"
							class:pending={order.status === 'pending'}
							class:accepted={order.status === 'accepted'}
						>
							{order.status}
						</span>
					</div>

					<div class="order-details">
						<p><strong>От:</strong> {order.pickup_address}</p>
						<p><strong>Куда:</strong> {order.delivery_address}</p>
						<p><strong>Стоимость:</strong> {order.total} ₽</p>
					</div>

					{#if order.customer}
						<div class="order-customer">
							<img
								src={order.customer.avatar_url || '/default-avatar.png'}
								alt={order.customer.nickname}
							/>
							<span>{order.customer.nickname}</span>
						</div>
					{/if}

					{#if order.driver}
						<div class="order-driver">
							<strong>Водитель:</strong>
							{order.driver.nickname}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.orders-list {
		padding: 2rem;
	}

	.orders {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	}

	.order-card {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1rem;
		background: white;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		transition: transform 0.2s;
	}

	.order-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
	}

	.order-header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.order-status {
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.order-status.pending {
		background: #fff3cd;
		color: #856404;
	}

	.order-status.accepted {
		background: #d4edda;
		color: #155724;
	}

	.order-details p {
		margin: 0.5rem 0;
		font-size: 0.875rem;
	}

	.order-customer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid #e0e0e0;
	}

	.order-customer img {
		width: 32px;
		height: 32px;
		border-radius: 50%;
	}

	.error {
		color: #dc3545;
	}
</style>
