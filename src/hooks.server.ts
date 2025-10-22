import type { Handle } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import { sequence } from '@sveltejs/kit/hooks';
import api from '$lib/server/api';
import { initSyncInfrastructure } from '$lib/server/sync';

// Инициализация sync инфраструктуры при старте сервера
let syncInitialized = false;
if (!syncInitialized) {
	initSyncInfrastructure().catch((err) => {
		console.error('Failed to initialize sync infrastructure:', err);
	});
	syncInitialized = true;
}

const handleAuth: Handle = async ({ event, resolve }) => {
	const sessionToken = event.cookies.get(auth.sessionCookieName);

	if (!sessionToken) {
		event.locals.user = null;
		event.locals.session = null;
		return resolve(event);
	}

	const { session, user } = await auth.validateSessionToken(sessionToken);

	if (session) {
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
	} else {
		auth.deleteSessionTokenCookie(event);
	}

	event.locals.user = user;
	event.locals.session = session;
	return resolve(event);
};

const handleApi: Handle = async ({ event, resolve }) => {
	// Обработка API requests через Hono
	if (event.url.pathname.startsWith('/api/')) {
		// Убираем /api префикс для Hono routing
		const url = new URL(event.url);
		url.pathname = url.pathname.replace('/api', '');

		// Создаем Hono Request из SvelteKit request
		const request = new Request(url.toString(), {
			method: event.request.method,
			headers: event.request.headers,
			body:
				event.request.method !== 'GET' && event.request.method !== 'HEAD'
					? event.request.body
					: undefined,
			// ВАЖНО: duplex требуется для streaming body
			duplex: 'half'
		} as RequestInit);

		// Обрабатываем через Hono
		const response = await api.fetch(request, {});

		return response;
	}

	// Обычная обработка SvelteKit routes
	return await resolve(event);
};

export const handle: Handle = sequence(handleAuth, handleApi);
