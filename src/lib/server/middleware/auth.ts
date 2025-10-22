/**
 * Auth Middleware
 *
 * Проверка аутентификации через session cookie
 * Извлекает userId из сессии и сохраняет в контексте
 */

import type { Context, Next } from 'hono';
import { db } from '../db/index';
import { session as sessionTable } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { HonoEnv } from '../api/hono-types';

export const authMiddleware = async (c: Context<HonoEnv>, next: Next) => {
	// Получаем session cookie (в реальном приложении через безопасные cookies)
	const sessionId = c.req.header('Authorization')?.replace('Bearer ', '');

	if (!sessionId) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	try {
		// Проверяем сессию
		const sessions = await db
			.select()
			.from(sessionTable)
			.where(eq(sessionTable.id, sessionId))
			.limit(1);

		if (sessions.length === 0) {
			return c.json({ error: 'Invalid session' }, 401);
		}

		const session = sessions[0];

		// Проверяем срок действия
		if (session.expiresAt < new Date()) {
			return c.json({ error: 'Session expired' }, 401);
		}

		// Сохраняем userId в контексте
		c.set('userId', session.userId);

		await next();
	} catch (err) {
		console.error('Auth error:', err);
		return c.json({ error: 'Authentication failed' }, 500);
	}
};

/**
 * Optional auth middleware (не требует авторизации, но извлекает userId если есть)
 */
export const optionalAuthMiddleware = async (c: Context<HonoEnv>, next: Next) => {
	const sessionId = c.req.header('Authorization')?.replace('Bearer ', '');

	if (sessionId) {
		try {
			const sessions = await db
				.select()
				.from(sessionTable)
				.where(eq(sessionTable.id, sessionId))
				.limit(1);

			if (sessions.length > 0 && sessions[0].expiresAt >= new Date()) {
				c.set('userId', sessions[0].userId);
			}
		} catch {
			// Игнорируем ошибки в optional auth
		}
	}

	await next();
};
