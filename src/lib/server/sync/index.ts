/**
 * Sync Infrastructure
 *
 * Централизованный экспорт всех компонентов системы синхронизации
 */

export { sseManager } from './sse-manager';
export { batchUpdateHandler } from './batch-handler';
export { postgresListener } from './postgres-listener';
export { syncManager } from './sync-manager';

/**
 * Инициализация sync инфраструктуры при старте сервера
 */
export async function initSyncInfrastructure() {
	try {
		console.log('🚀 Initializing sync infrastructure...');

		// Запускаем PostgreSQL Listener
		const { postgresListener } = await import('./postgres-listener');
		await postgresListener.start();

		console.log('✅ Sync infrastructure initialized');
	} catch (error) {
		console.error('❌ Failed to initialize sync infrastructure:', error);
		throw error;
	}
}

/**
 * Graceful shutdown sync инфраструктуры
 */
export async function shutdownSyncInfrastructure() {
	try {
		console.log('🛑 Shutting down sync infrastructure...');

		const { postgresListener } = await import('./postgres-listener');
		const { sseManager } = await import('./sse-manager');

		await postgresListener.stop();
		await sseManager.shutdown();

		console.log('✅ Sync infrastructure shut down');
	} catch (error) {
		console.error('❌ Error during shutdown:', error);
	}
}
