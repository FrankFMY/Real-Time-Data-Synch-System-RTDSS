/**
 * API Endpoint тесты для Orders routes
 *
 * Проверка бизнес-логики и батчинга
 */

import { describe, it, expect } from 'vitest';
import app from '../../src/lib/server/api/index';
import { pool } from '../../src/lib/server/db/pool';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_SESSION_TOKEN = 'demo-session-token';

describe('Orders API Endpoints', () => {
	describe('POST /orders', () => {
		it('должен создать заказ и вызвать flush_batch_notifications', async () => {
			const request = new Request('http://localhost/orders', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'order-create-test'
				},
				body: JSON.stringify({
					pickup_address: 'Test Pickup Street 123',
					delivery_address: 'Test Delivery Ave 456',
					total: 2500,
					description: 'Integration test order'
				}),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});
			const result = await response.json();

			expect(response.status).toBe(200);
			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data.id).toBeDefined();
			expect(result.data.total).toBe(2500);
			expect(result.data.status).toBe('pending');
			expect(result.meta?.excluded_from_sse).toBe(true);
		});

		it('должен вернуть 400 если нет обязательных полей', async () => {
			const request = new Request('http://localhost/orders', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'bad-request-test'
				},
				body: JSON.stringify({
					// Нет pickup_address, delivery_address, total
					description: 'Missing fields'
				}),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});

			expect(response.status).toBe(400);
		});
	});

	describe('POST /orders/:id/accept', () => {
		it('должен принять заказ и создать notification', async () => {
			const client = await pool.connect();
			let orderId: string;

			try {
				// Создаём тестовый заказ
				await client.query('BEGIN');
				await client.query(`SET LOCAL app.current_user_id = '${TEST_USER_ID}'`);

				const result = await client.query(
					`
					INSERT INTO "order" (customer_id, pickup_address, delivery_address, total, status)
					VALUES ($1, 'Pickup', 'Delivery', 3000, 'pending')
					RETURNING id
				`,
					[TEST_USER_ID]
				);

				orderId = result.rows[0].id;
				await client.query('COMMIT');
			} finally {
				client.release();
			}

			// Принимаем заказ
			const request = new Request(`http://localhost/orders/${orderId}/accept`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'accept-test-client'
				},
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});
			const result = await response.json();

			expect(response.status).toBe(200);
			expect(result.success).toBe(true);
			expect(result.data.status).toBe('accepted');
			expect(result.data.driver_id).toBe(TEST_USER_ID);
			expect(result.data.accepted_at).toBeDefined();
		});

		it('должен вернуть 404 для уже принятого заказа', async () => {
			const client = await pool.connect();
			let orderId: string;

			try {
				await client.query('BEGIN');
				await client.query(`SET LOCAL app.current_user_id = '${TEST_USER_ID}'`);

				const result = await client.query(
					`
					INSERT INTO "order" (customer_id, driver_id, pickup_address, delivery_address, total, status)
					VALUES ($1, $1, 'P', 'D', 1000, 'accepted')
					RETURNING id
				`,
					[TEST_USER_ID]
				);

				orderId = result.rows[0].id;
				await client.query('COMMIT');
			} finally {
				client.release();
			}

			const request = new Request(`http://localhost/orders/${orderId}/accept`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'duplicate-accept-test'
				},
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});

			expect(response.status).toBe(404);
		});
	});

	describe('POST /orders/:id/cancel', () => {
		it('должен отменить заказ с reason', async () => {
			const client = await pool.connect();
			let orderId: string;

			try {
				await client.query('BEGIN');
				await client.query(`SET LOCAL app.current_user_id = '${TEST_USER_ID}'`);

				const result = await client.query(
					`
					INSERT INTO "order" (customer_id, pickup_address, delivery_address, total, status)
					VALUES ($1, 'P', 'D', 1500, 'pending')
					RETURNING id
				`,
					[TEST_USER_ID]
				);

				orderId = result.rows[0].id;
				await client.query('COMMIT');
			} finally {
				client.release();
			}

			const request = new Request(`http://localhost/orders/${orderId}/cancel`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
					'X-Client-Id': 'cancel-test-client'
				},
				body: JSON.stringify({
					reason: 'Integration test cancellation'
				}),
				duplex: 'half'
			} as RequestInit);

			const response = await app.fetch(request, {});
			const result = await response.json();

			expect(response.status).toBe(200);
			expect(result.success).toBe(true);
			expect(result.data.status).toBe('cancelled');
			expect(result.data.completed_at).toBeDefined();
		});
	});
});
