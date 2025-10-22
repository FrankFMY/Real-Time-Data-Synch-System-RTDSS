/**
 * Orders API Routes
 *
 * Business logic для работы с заказами
 * Все мутирующие операции используют батчинг через flush_batch_notifications()
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { clientIdMiddleware } from '../middleware/client-id';
import { pool, setUserContext, setClientIdContext } from '../db/pool';
import type { HonoEnv } from './hono-types';

const app = new Hono<HonoEnv>();

// Применяем middleware
app.use('*', clientIdMiddleware);
app.use('*', authMiddleware);

/**
 * Create Order
 * POST /api/orders
 */
app.post('/', async (c) => {
	const userId = c.get('userId') as string;
	const clientId = c.get('clientId') as string;

	try {
		const body = await c.req.json();
		const { pickup_address, delivery_address, total, description, organization_id } = body;

		if (!pickup_address || !delivery_address || !total) {
			return c.json({ error: 'Missing required fields' }, 400);
		}

		const client = await pool.connect();

		try {
			// Устанавливаем контекст
			await setUserContext(client, userId);
			if (clientId) {
				await setClientIdContext(client, clientId);
			}

			await client.query('BEGIN');

			// Создаем заказ
			const result = await client.query(
				`INSERT INTO "order" (customer_id, pickup_address, delivery_address, total, description, organization_id, status)
				 VALUES ($1, $2, $3, $4, $5, $6, 'pending')
				 RETURNING *`,
				[
					userId,
					pickup_address,
					delivery_address,
					total,
					description || null,
					organization_id || null
				]
			);

			const newOrder = result.rows[0];

			// Создаем запись в истории
			await client.query(
				`INSERT INTO order_history (order_id, user_id, action, details)
				 VALUES ($1, $2, 'created', $3)`,
				[newOrder.id, userId, JSON.stringify({ total, pickup_address })]
			);

			// ВАЖНО: Отправляем батч
			await client.query('SELECT flush_batch_notifications()');

			await client.query('COMMIT');

			return c.json({
				success: true,
				data: newOrder,
				meta: { client_id: clientId, excluded_from_sse: true }
			});
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} catch (err) {
		const error = err as Error;
		console.error('Create order error:', error);
		return c.json({ error: error.message }, 500);
	}
});

/**
 * Accept Order (для водителей)
 * POST /api/orders/:id/accept
 */
app.post('/:id/accept', async (c) => {
	const userId = c.get('userId') as string;
	const clientId = c.get('clientId') as string;
	const orderId = c.req.param('id');

	try {
		const client = await pool.connect();

		try {
			// Устанавливаем контекст
			await setUserContext(client, userId);
			if (clientId) {
				await setClientIdContext(client, clientId);
			}

			await client.query('BEGIN');

			// Проверяем что заказ pending
			const orderCheck = await client.query(
				`SELECT * FROM "order" WHERE id = $1 AND status = 'pending' FOR UPDATE`,
				[orderId]
			);

			if (orderCheck.rows.length === 0) {
				await client.query('ROLLBACK');
				return c.json({ error: 'Order not found or already accepted' }, 404);
			}

			// Обновляем заказ
			const result = await client.query(
				`UPDATE "order" SET status = 'accepted', driver_id = $1, accepted_at = NOW()
				 WHERE id = $2
				 RETURNING *`,
				[userId, orderId]
			);

			const updatedOrder = result.rows[0];

			// История
			await client.query(
				`INSERT INTO order_history (order_id, user_id, action)
				 VALUES ($1, $2, 'accepted')`,
				[orderId, userId]
			);

			// Уведомление заказчику
			await client.query(
				`INSERT INTO notification (user_id, type, title, message, data)
				 VALUES ($1, 'order_accepted', $2, $3, $4)`,
				[
					updatedOrder.customer_id,
					'Заказ принят',
					'Водитель выехал к вам',
					JSON.stringify({ order_id: orderId })
				]
			);

			// ВАЖНО: Отправляем батч
			await client.query('SELECT flush_batch_notifications()');

			await client.query('COMMIT');

			// Возвращаем полные данные с includes
			const fullOrder = await client.query(
				`SELECT o.*, 
					row_to_json(customer.*) as customer,
					row_to_json(driver.*) as driver
				 FROM "order" o
				 LEFT JOIN "user" customer ON o.customer_id = customer.id
				 LEFT JOIN "user" driver ON o.driver_id = driver.id
				 WHERE o.id = $1`,
				[orderId]
			);

			return c.json({
				success: true,
				data: fullOrder.rows[0],
				meta: { client_id: clientId, excluded_from_sse: true }
			});
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} catch (err) {
		const error = err as Error;
		console.error('Accept order error:', error);
		return c.json({ error: error.message }, 500);
	}
});

/**
 * Update Order Status
 * PATCH /api/orders/:id/status
 */
app.patch('/:id/status', async (c) => {
	const userId = c.get('userId') as string;
	const clientId = c.get('clientId') as string;
	const orderId = c.req.param('id');

	try {
		const body = await c.req.json();
		const { status } = body;

		if (!status) {
			return c.json({ error: 'status required' }, 400);
		}

		const client = await pool.connect();

		try {
			// Устанавливаем контекст
			await setUserContext(client, userId);
			if (clientId) {
				await setClientIdContext(client, clientId);
			}

			await client.query('BEGIN');

			// Обновляем статус
			const result = await client.query(
				`UPDATE "order" SET status = $1, completed_at = CASE WHEN $1 IN ('delivered', 'cancelled') THEN NOW() ELSE completed_at END
				 WHERE id = $2 AND (driver_id = $3 OR customer_id = $3)
				 RETURNING *`,
				[status, orderId, userId]
			);

			if (result.rows.length === 0) {
				await client.query('ROLLBACK');
				return c.json({ error: 'Order not found or access denied' }, 404);
			}

			const updatedOrder = result.rows[0];

			// История
			await client.query(
				`INSERT INTO order_history (order_id, user_id, action, details)
				 VALUES ($1, $2, 'status_changed', $3)`,
				[orderId, userId, JSON.stringify({ new_status: status })]
			);

			// Уведомление другой стороне
			const notifyUserId =
				updatedOrder.driver_id === userId ? updatedOrder.customer_id : updatedOrder.driver_id;

			if (notifyUserId) {
				await client.query(
					`INSERT INTO notification (user_id, type, title, message, data)
					 VALUES ($1, 'order_status_changed', $2, $3, $4)`,
					[
						notifyUserId,
						'Статус заказа изменён',
						`Заказ теперь: ${status}`,
						JSON.stringify({ order_id: orderId, status })
					]
				);
			}

			// ВАЖНО: Отправляем батч
			await client.query('SELECT flush_batch_notifications()');

			await client.query('COMMIT');

			return c.json({
				success: true,
				data: updatedOrder,
				meta: { client_id: clientId, excluded_from_sse: true }
			});
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} catch (err) {
		const error = err as Error;
		console.error('Update order status error:', error);
		return c.json({ error: error.message }, 500);
	}
});

/**
 * Cancel Order
 * POST /api/orders/:id/cancel
 */
app.post('/:id/cancel', async (c) => {
	const userId = c.get('userId') as string;
	const clientId = c.get('clientId') as string;
	const orderId = c.req.param('id');

	try {
		const body = await c.req.json();
		const { reason } = body;

		const client = await pool.connect();

		try {
			// Устанавливаем контекст
			await setUserContext(client, userId);
			if (clientId) {
				await setClientIdContext(client, clientId);
			}

			await client.query('BEGIN');

			// Отменяем заказ
			const result = await client.query(
				`UPDATE "order" SET status = 'cancelled', completed_at = NOW()
				 WHERE id = $1 AND (customer_id = $2 OR driver_id = $2) AND status NOT IN ('delivered', 'cancelled')
				 RETURNING *`,
				[orderId, userId]
			);

			if (result.rows.length === 0) {
				await client.query('ROLLBACK');
				return c.json({ error: 'Order not found, already completed, or access denied' }, 404);
			}

			const cancelledOrder = result.rows[0];

			// История
			await client.query(
				`INSERT INTO order_history (order_id, user_id, action, details)
				 VALUES ($1, $2, 'cancelled', $3)`,
				[orderId, userId, JSON.stringify({ reason: reason || 'No reason provided' })]
			);

			// ВАЖНО: Отправляем батч
			await client.query('SELECT flush_batch_notifications()');

			await client.query('COMMIT');

			return c.json({
				success: true,
				data: cancelledOrder,
				meta: { client_id: clientId, excluded_from_sse: true }
			});
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} catch (err) {
		const error = err as Error;
		console.error('Cancel order error:', error);
		return c.json({ error: error.message }, 500);
	}
});

export default app;
