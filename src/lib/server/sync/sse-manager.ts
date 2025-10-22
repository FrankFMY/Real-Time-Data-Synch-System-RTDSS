/**
 * SSE Manager
 *
 * Управление Server-Sent Events соединениями для real-time синхронизации
 */

import { redis, RedisKeys } from '../redis';
import type { SSEStreamingApi } from 'hono/streaming';

interface SSEConnection {
	clientId: string;
	userId: string;
	stream: SSEStreamingApi;
	connectedAt: number;
	lastHeartbeat: number;
}

export class SSEManager {
	private connections: Map<string, SSEConnection>;
	private heartbeatInterval: NodeJS.Timeout | null;

	constructor() {
		this.connections = new Map();
		this.heartbeatInterval = null;
	}

	/**
	 * Создать SSE соединение для клиента
	 */
	async createConnection(clientId: string, userId: string, stream: SSEStreamingApi): Promise<void> {
		// Регистрируем соединение
		this.connections.set(clientId, {
			clientId,
			userId,
			stream,
			connectedAt: Date.now(),
			lastHeartbeat: Date.now()
		});

		// Добавляем в Redis список клиентов пользователя
		await redis.sadd(RedisKeys.userClients(userId), clientId);

		console.log(`✅ SSE connected: ${clientId} (user: ${userId})`);

		// Отправляем подтверждение подключения
		await this.sendToClient(clientId, {
			type: 'connected',
			data: { clientId, timestamp: Date.now() }
		});

		// Запускаем heartbeat если ещё не запущен
		if (!this.heartbeatInterval) {
			this.startHeartbeat();
		}
	}

	/**
	 * Отправить событие конкретному клиенту
	 */
	async sendToClient(clientId: string, event: { type: string; data: unknown }): Promise<boolean> {
		const connection = this.connections.get(clientId);
		if (!connection) {
			return false;
		}

		try {
			await connection.stream.writeSSE({
				data: JSON.stringify(event.data),
				event: event.type
			});
			return true;
		} catch (err) {
			console.error(`❌ Failed to send to ${clientId}:`, err);
			void this.closeConnection(clientId);
			return false;
		}
	}

	/**
	 * Отправить событие всем клиентам пользователя
	 */
	async sendToUser(userId: string, event: { type: string; data: unknown }): Promise<number> {
		// Получаем всех клиентов пользователя
		const clientIds = await redis.smembers(RedisKeys.userClients(userId));

		let sent = 0;
		for (const clientId of clientIds) {
			if (await this.sendToClient(clientId, event)) {
				sent++;
			}
		}

		return sent;
	}

	/**
	 * Закрыть соединение
	 */
	async closeConnection(clientId: string): Promise<void> {
		const connection = this.connections.get(clientId);
		if (!connection) {
			return;
		}

		try {
			// Закрываем stream
			connection.stream.close();
		} catch {
			// Игнорируем ошибки при закрытии
		}

		// Удаляем все подписки клиента из Redis
		const collections = await redis.smembers(RedisKeys.clientCollections(clientId));

		for (const collectionKey of collections) {
			const [collectionId, userId] = collectionKey.split(':');
			await redis.srem(RedisKeys.collectionSubscriptions(collectionId, userId), clientId);
		}

		// Удаляем из user_clients
		await redis.srem(RedisKeys.userClients(connection.userId), clientId);

		// Удаляем список коллекций клиента
		await redis.del(RedisKeys.clientCollections(clientId));

		// Удаляем соединение из памяти
		this.connections.delete(clientId);

		console.log(`👋 SSE closed: ${clientId}`);
	}

	/**
	 * Получить информацию о соединении
	 */
	getConnection(clientId: string): SSEConnection | undefined {
		return this.connections.get(clientId);
	}

	/**
	 * Получить все соединения пользователя
	 */
	getUserConnections(userId: string): SSEConnection[] {
		const connections: SSEConnection[] = [];
		for (const connection of this.connections.values()) {
			if (connection.userId === userId) {
				connections.push(connection);
			}
		}
		return connections;
	}

	/**
	 * Получить статистику
	 */
	getStats() {
		const users = new Set<string>();
		for (const connection of this.connections.values()) {
			users.add(connection.userId);
		}

		return {
			totalConnections: this.connections.size,
			uniqueUsers: users.size,
			avgConnectionsPerUser: users.size > 0 ? this.connections.size / users.size : 0
		};
	}

	/**
	 * Heartbeat для поддержания соединений
	 */
	private startHeartbeat(): void {
		this.heartbeatInterval = setInterval(async () => {
			const now = Date.now();
			const staleConnections: string[] = [];

			for (const [clientId, connection] of this.connections) {
				// Проверяем timeout (90 секунд без heartbeat)
				if (now - connection.lastHeartbeat > 90000) {
					staleConnections.push(clientId);
					continue;
				}

				// Отправляем heartbeat (каждые 30 секунд)
				try {
					await connection.stream.writeSSE({
						data: 'heartbeat',
						event: 'heartbeat'
					});
					connection.lastHeartbeat = now;
				} catch {
					staleConnections.push(clientId);
				}
			}

			// Закрываем stale соединения
			for (const clientId of staleConnections) {
				console.log(`⏱️  Closing stale connection: ${clientId}`);
				void this.closeConnection(clientId);
			}
		}, 30000); // Каждые 30 секунд

		console.log('💓 SSE heartbeat started');
	}

	/**
	 * Остановить heartbeat
	 */
	stopHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
			console.log('💔 SSE heartbeat stopped');
		}
	}

	/**
	 * Cleanup при shutdown
	 */
	async shutdown(): Promise<void> {
		console.log('🛑 Shutting down SSE Manager...');

		this.stopHeartbeat();

		// Закрываем все соединения
		const clientIds = Array.from(this.connections.keys());
		for (const clientId of clientIds) {
			await this.closeConnection(clientId);
		}

		console.log('✅ SSE Manager shut down');
	}
}

// Singleton instance
export const sseManager = new SSEManager();
