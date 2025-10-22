/**
 * PostgreSQL Listener
 *
 * Слушает NOTIFY события из PostgreSQL и передает в Batch Handler
 */

import { pool } from '../db/pool';
import { batchUpdateHandler } from './batch-handler';
import type { PoolClient } from 'pg';

export class PostgresListener {
	private client: PoolClient | null = null;
	private isListening = false;

	/**
	 * Запустить listener
	 */
	async start(): Promise<void> {
		if (this.isListening) {
			console.warn('⚠️  PostgreSQL listener already running');
			return;
		}

		try {
			// Получаем dedicated клиента для LISTEN
			this.client = await pool.connect();

			// Подписываемся на канал batch_updates
			await this.client.query('LISTEN batch_updates');

			// Обработчик уведомлений
			this.client.on('notification', async (msg) => {
				if (msg.channel === 'batch_updates' && msg.payload) {
					try {
						await batchUpdateHandler.handleBatch(msg.payload);
					} catch (error) {
						console.error('❌ Error handling batch:', error);
					}
				}
			});

			// Обработчик ошибок
			this.client.on('error', (err) => {
				console.error('❌ PostgreSQL listener error:', err);
				this.reconnect();
			});

			// Обработчик закрытия соединения
			this.client.on('end', () => {
				console.warn('⚠️  PostgreSQL listener connection ended');
				this.reconnect();
			});

			this.isListening = true;
			console.log('✅ PostgreSQL listener started');
		} catch (error) {
			console.error('❌ Failed to start PostgreSQL listener:', error);
			throw error;
		}
	}

	/**
	 * Остановить listener
	 */
	async stop(): Promise<void> {
		if (!this.isListening || !this.client) {
			return;
		}

		try {
			await this.client.query('UNLISTEN batch_updates');
			this.client.release();
			this.client = null;
			this.isListening = false;
			console.log('✅ PostgreSQL listener stopped');
		} catch (err) {
			console.error('❌ Error stopping PostgreSQL listener:', err);
		}
	}

	/**
	 * Переподключиться при ошибке
	 */
	private async reconnect(): Promise<void> {
		console.log('🔄 Reconnecting PostgreSQL listener...');

		this.isListening = false;

		if (this.client) {
			try {
				this.client.release();
			} catch {
				// Игнорируем ошибки при release
			}
			this.client = null;
		}

		// Ждём 5 секунд перед переподключением
		await new Promise((resolve) => setTimeout(resolve, 5000));

		try {
			await this.start();
			console.log('✅ PostgreSQL listener reconnected');
		} catch (err) {
			console.error('❌ Reconnection failed:', err);
			// Пробуем ещё раз через 10 секунд
			setTimeout(() => void this.reconnect(), 10000);
		}
	}

	/**
	 * Проверка статуса
	 */
	isActive(): boolean {
		return this.isListening && this.client !== null;
	}
}

// Singleton instance
export const postgresListener = new PostgresListener();
