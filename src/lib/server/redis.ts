import { Redis } from 'ioredis';
import { env } from '$env/dynamic/private';

if (!env.REDIS_URL) {
	throw new Error('REDIS_URL is not set');
}

// Основной Redis клиент для операций
export const redis = new Redis(env.REDIS_URL, {
	maxRetriesPerRequest: 3,
	retryStrategy(times) {
		const delay = Math.min(times * 50, 2000);
		return delay;
	},
	reconnectOnError(err) {
		const targetError = 'READONLY';
		if (err.message.includes(targetError)) {
			return true;
		}
		return false;
	}
});

redis.on('connect', () => {
	console.log('✅ Redis connected');
});

redis.on('error', (err) => {
	console.error('❌ Redis error:', err);
});

redis.on('reconnecting', () => {
	console.log('🔄 Redis reconnecting...');
});

// Redis ключи для организации данных
export const RedisKeys = {
	// Подписки на коллекции: collection_subscriptions:{collection_id}:{user_id}
	collectionSubscriptions: (collectionId: string, userId: string) =>
		`collection_subscriptions:${collectionId}:${userId}`,

	// Все коллекции клиента: client_collections:{client_id}
	clientCollections: (clientId: string) => `client_collections:${clientId}`,

	// Все клиенты пользователя: user_clients:{user_id}
	userClients: (userId: string) => `user_clients:${userId}`,

	// Кэш данных коллекций: collection_cache:{collection_id}:{user_id}
	collectionCache: (collectionId: string, userId: string) =>
		`collection_cache:${collectionId}:${userId}`
};
