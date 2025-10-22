/**
 * API Endpoint тесты для Sync routes
 */

import { describe, it, expect } from 'vitest';
import app from '../../src/lib/server/api/index';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_SESSION_TOKEN = 'demo-session-token';

describe('Sync API Endpoints', () => {
	describe('POST /sync/subscribe', () => {
		it('должен требовать авторизацию', async () => {
			const request = new Request('http://localhost/sync/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ collection_id: 'orders_active' })
			});

			const response = await app.fetch(request, {});

			expect(response.status).toBe(401);
		});

		it('должен требовать X-Client-Id', async () => {
			const request = new Request('http://localhost/sync/subscribe', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`
				},
				body: JSON.stringify({ collection_id: 'orders_active' }),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});
			const result = await response.json();

			expect(response.status).toBe(400);
			expect(result.error).toContain('X-Client-Id');
		});

		it('должен требовать collection_id', async () => {
			const request = new Request('http://localhost/sync/subscribe', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'test-client'
				},
				body: JSON.stringify({}),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});
			const result = await response.json();

			expect(response.status).toBe(400);
			expect(result.error).toContain('collection_id');
		});

		it('должен успешно подписать клиента', async () => {
			const request = new Request('http://localhost/sync/subscribe', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'subscribe-test-client'
				},
				body: JSON.stringify({
					collection_id: 'orders_active',
					client_id: 'subscribe-test-client'
				}),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});
			const result = await response.json();

			expect(response.status).toBe(200);
			expect(result.success).toBe(true);
		});
	});

	describe('POST /sync', () => {
		it('должен вернуть diff с правильной структурой', async () => {
			const request = new Request('http://localhost/sync', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'diff-test-client'
				},
				body: JSON.stringify({
					collection_id: 'orders_active',
					state_vector: {}
				}),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});
			const result = await response.json();

			expect(response.status).toBe(200);
			expect(result).toHaveProperty('new');
			expect(result).toHaveProperty('updated');
			expect(result).toHaveProperty('unchanged');
			expect(result).toHaveProperty('removed');
		});

		it('должен обработать параметризованную коллекцию', async () => {
			const request = new Request('http://localhost/sync', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'param-test-client'
				},
				body: JSON.stringify({
					collection_id: 'user_profile:*',
					state_vector: {},
					params: { param: TEST_USER_ID }
				}),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});

			expect(response.status).toBe(200);
		});
	});

	describe('GET /sync/stats', () => {
		it('должен вернуть статистику системы', async () => {
			const request = new Request('http://localhost/sync/stats', {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`
				}
			});

			const response = await app.fetch(request, {});
			const result = await response.json();

			expect(response.status).toBe(200);
			expect(result).toHaveProperty('sse');
			expect(result).toHaveProperty('subscriptions');
			expect(result.sse).toHaveProperty('totalConnections');
			expect(result.sse).toHaveProperty('uniqueUsers');
		});
	});
});
