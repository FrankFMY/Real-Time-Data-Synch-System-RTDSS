/**
 * Client ID Middleware
 *
 * Извлекает X-Client-Id из headers и сохраняет в контексте
 */

import type { Context, Next } from 'hono';
import type { HonoEnv } from '../api/hono-types';

export const clientIdMiddleware = async (c: Context<HonoEnv>, next: Next) => {
	const clientId = c.req.header('X-Client-Id');

	if (clientId) {
		// Сохраняем в контексте запроса
		c.set('clientId', clientId);
	}

	await next();
};
