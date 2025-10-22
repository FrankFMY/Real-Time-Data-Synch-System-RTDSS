import pg from 'pg';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set');
}

// Connection Pool для LISTEN/NOTIFY и общих операций
export const pool = new pg.Pool({
	connectionString: env.DATABASE_URL,
	max: 20, // Максимум соединений
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000
});

pool.on('connect', () => {
	console.log('✅ PostgreSQL pool connected');
});

pool.on('error', (err) => {
	console.error('❌ PostgreSQL pool error:', err);
});

// Функция для установки контекста пользователя (для RLS)
export async function setUserContext(client: pg.PoolClient, userId: string) {
	// Валидация UUID для безопасности
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
		throw new Error('Invalid UUID format');
	}
	// SET LOCAL не поддерживает параметры, используем прямую подстановку после валидации
	await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
}

// Функция для установки client_id (для исключения initiator из SSE)
export async function setClientIdContext(client: pg.PoolClient, clientId: string) {
	// Экранируем одинарные кавычки для безопасности
	const escapedClientId = clientId.replace(/'/g, "''");
	await client.query(`SET LOCAL app.initiator_client_id = '${escapedClientId}'`);
}
