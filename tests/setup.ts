/**
 * Test Setup
 *
 * Глобальная конфигурация для всех тестов
 */

import { beforeAll, afterAll, afterEach } from 'vitest';
import { cleanupRedis, cleanupDatabase } from './fixtures/test-utils';

// Глобальный setup перед всеми тестами
beforeAll(async () => {
	console.log('🧪 Initializing test environment...');

	// Проверяем что Docker запущен (только для integration тестов)
	if (
		process.env.VITEST_POOL_ID?.includes('integration') ||
		process.env.VITEST_POOL_ID?.includes('api')
	) {
		const { pool } = await import('../src/lib/server/db/pool');

		try {
			const client = await pool.connect();
			await client.query('SELECT 1');
			client.release();
			console.log('✅ PostgreSQL connected');
		} catch (err) {
			console.error('❌ PostgreSQL not available. Run: pnpm db:start');
			throw err;
		}
	}

	console.log('✅ Test environment ready\n');
});

// Cleanup после каждого теста (только для integration)
afterEach(async () => {
	if (
		process.env.VITEST_POOL_ID?.includes('integration') ||
		process.env.VITEST_POOL_ID?.includes('api')
	) {
		await cleanupRedis();
	}
});

// Глобальный cleanup после всех тестов
afterAll(async () => {
	if (
		process.env.VITEST_POOL_ID?.includes('integration') ||
		process.env.VITEST_POOL_ID?.includes('api')
	) {
		console.log('\n🧹 Cleaning up test environment...');

		await cleanupDatabase();
		await cleanupRedis();

		// Закрываем соединения
		const { pool } = await import('../src/lib/server/db/pool');
		const { redis } = await import('../src/lib/server/redis');

		await pool.end();
		await redis.quit();

		console.log('✅ Test environment cleaned up');
	}
});
