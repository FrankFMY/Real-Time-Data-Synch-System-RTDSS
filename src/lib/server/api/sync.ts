/**
 * Sync API Routes
 *
 * Endpoints для синхронизации данных:
 * - SSE соединение
 * - Подписка/отписка от коллекций
 * - Differential sync
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { sseManager, syncManager } from '../sync';
import { authMiddleware } from '../middleware/auth';
import { clientIdMiddleware } from '../middleware/client-id';
import type { HonoEnv } from './hono-types';
import { db } from '../db/index';
import { session as sessionTable } from '../db/schema';
import { eq } from 'drizzle-orm';

const app = new Hono<HonoEnv>();

/**
 * SSE Endpoint (БЕЗ middleware - валидация внутри)
 * GET /api/sync/events
 *
 * Устанавливает Server-Sent Events соединение для real-time обновлений
 */
app.get('/events', async (c) => {
	// Для SSE используем token из query параметра (EventSource не поддерживает headers)
	const token = c.req.query('token');

	if (!token) {
		return c.json({ error: 'Token required in query' }, 401);
	}

	// Валидируем сессию
	const sessions = await db.select().from(sessionTable).where(eq(sessionTable.id, token)).limit(1);

	if (sessions.length === 0 || sessions[0].expiresAt < new Date()) {
		return c.json({ error: 'Invalid or expired session' }, 401);
	}

	const userId = sessions[0].userId;
	let clientId = c.req.query('client_id') || (c.get('clientId') as string);

	// Генерируем clientId если не предоставлен
	if (!clientId) {
		clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	console.log(`🔌 SSE connection request: ${clientId} (user: ${userId})`);

	return streamSSE(c, async (stream) => {
		// Обработчик отключения
		stream.onAbort(() => {
			console.log(`🔌 SSE aborted: ${clientId}`);
			void sseManager.closeConnection(clientId);
		});

		// Создаем SSE соединение
		await sseManager.createConnection(clientId, userId, stream);

		// Держим соединение открытым (heartbeat управляется SSEManager)
		// Используем большой, но разумный timeout (24 часа)
		let keepAlive = true;
		stream.onAbort(() => {
			keepAlive = false;
		});

		while (keepAlive) {
			await stream.sleep(86400000); // 24 часа
		}
	});
});

// Применяем middleware ко всем остальным routes
app.use('*', clientIdMiddleware);
app.use('*', authMiddleware);

/**
 * Subscribe to Collection
 * POST /api/sync/subscribe
 *
 * Подписаться на коллекцию для получения real-time обновлений
 */
app.post('/subscribe', async (c) => {
	const userId = c.get('userId') as string;
	const clientId = c.get('clientId') as string;

	if (!clientId) {
		return c.json({ error: 'X-Client-Id header required' }, 400);
	}

	try {
		const body = await c.req.json();
		const { collection_id, params } = body;

		if (!collection_id) {
			return c.json({ error: 'collection_id required' }, 400);
		}

		await syncManager.subscribeCollection(collection_id, userId, clientId, params);

		return c.json({ success: true });
	} catch (err) {
		const error = err as Error;
		console.error('Subscribe error:', error);
		return c.json({ error: error.message }, 500);
	}
});

/**
 * Unsubscribe from Collection
 * POST /api/sync/unsubscribe
 *
 * Отписаться от коллекции
 */
app.post('/unsubscribe', async (c) => {
	const userId = c.get('userId') as string;
	const clientId = c.get('clientId') as string;

	if (!clientId) {
		return c.json({ error: 'X-Client-Id header required' }, 400);
	}

	try {
		const body = await c.req.json();
		const { collection_id } = body;

		if (!collection_id) {
			return c.json({ error: 'collection_id required' }, 400);
		}

		await syncManager.unsubscribeCollection(collection_id, userId, clientId);

		return c.json({ success: true });
	} catch (err) {
		const error = err as Error;
		console.error('Unsubscribe error:', error);
		return c.json({ error: error.message }, 500);
	}
});

/**
 * Differential Sync
 * POST /api/sync
 *
 * Получить изменения коллекции с учетом state vector клиента
 */
app.post('/', async (c) => {
	const userId = c.get('userId') as string;

	try {
		const body = await c.req.json();
		const { collection_id, state_vector, params } = body;

		if (!collection_id) {
			return c.json({ error: 'collection_id required' }, 400);
		}

		const diff = await syncManager.syncCollection(
			collection_id,
			userId,
			state_vector || {},
			params
		);

		return c.json(diff);
	} catch (err) {
		const error = err as Error;
		console.error('Sync error:', error);
		return c.json({ error: error.message }, 500);
	}
});

/**
 * Stats Endpoint (для мониторинга)
 * GET /api/sync/stats
 */
app.get('/stats', async (c) => {
	try {
		const sseStats = sseManager.getStats();
		const subscriptionStats = await syncManager.getSubscriptionStats();

		return c.json({
			sse: sseStats,
			subscriptions: subscriptionStats,
			timestamp: Date.now()
		});
	} catch (err) {
		const error = err as Error;
		console.error('Stats error:', error);
		return c.json({ error: error.message }, 500);
	}
});

export default app;
