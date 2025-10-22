/**
 * Main API
 *
 * Объединяет все API routes
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import syncRoutes from './sync';
import ordersRoutes from './orders';
import type { HonoEnv } from './hono-types';

const app = new Hono<HonoEnv>();

// CORS для development
app.use(
	'*',
	cors({
		origin: ['http://localhost:5173', 'http://localhost:4173'],
		credentials: true
	})
);

// Health check
app.get('/health', (c) => {
	return c.json({
		status: 'ok',
		timestamp: Date.now()
	});
});

// Mount routes
app.route('/sync', syncRoutes);
app.route('/orders', ordersRoutes);

// 404 handler
app.notFound((c) => {
	return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
	console.error('API error:', err);
	return c.json(
		{
			error: err.message || 'Internal server error'
		},
		500
	);
});

export default app;
