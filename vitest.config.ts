import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit(), svelte()],
	test: {
		globals: true,
		environment: 'node',
		setupFiles: ['./tests/setup.ts'],
		include: ['tests/**/*.test.ts'],
		exclude: [
			'tests/**/*.spec.ts',
			'tests/unit/client/**', // Пропускаем client (требуют Svelte runtime)
			'node_modules/**'
		],
		testTimeout: 20000,
		hookTimeout: 30000,
		fileParallelism: false, // КРИТИЧНО: тесты последовательно (изолируем SSE/Redis)
		pool: 'forks',
		poolOptions: {
			forks: {
				singleFork: true
			}
		}
	},
	resolve: {
		alias: {
			$lib: '/src/lib'
		}
	}
});
