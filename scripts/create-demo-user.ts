/**
 * Создание demo пользователя и сессии для тестирования
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { user, session } from '../src/lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set');
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client, { schema: { user, session } });

// Фиксированные UUID для demo
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_SESSION_ID = 'demo-session-token';

async function createDemoUser() {
	console.log('🚀 Creating demo user and session...\n');

	try {
		// Проверяем существующего пользователя
		const existingUsers = await db.select().from(user).where(eq(user.id, DEMO_USER_ID)).limit(1);

		if (existingUsers.length > 0) {
			console.log('✅ Demo user already exists');
		} else {
			// Создаем demo пользователя
			await db.insert(user).values({
				id: DEMO_USER_ID,
				nickname: 'Demo User',
				email: 'demo@example.com',
				phone: '+1234567890',
				role: 'user',
				balance: 1000
			});
			console.log('✅ Demo user created');
		}

		// Проверяем существующую сессию
		const existingSessions = await db
			.select()
			.from(session)
			.where(eq(session.id, DEMO_SESSION_ID))
			.limit(1);

		if (existingSessions.length > 0) {
			// Обновляем срок действия
			await db
				.update(session)
				.set({
					expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 год
				})
				.where(eq(session.id, DEMO_SESSION_ID));
			console.log('✅ Demo session updated');
		} else {
			// Создаем demo сессию
			await db.insert(session).values({
				id: DEMO_SESSION_ID,
				userId: DEMO_USER_ID,
				expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 год
			});
			console.log('✅ Demo session created');
		}

		console.log('\n━'.repeat(30));
		console.log('✅ Demo user setup complete!');
		console.log('\n📋 Credentials:');
		console.log(`   User ID: ${DEMO_USER_ID}`);
		console.log(`   Session Token: ${DEMO_SESSION_ID}`);
		console.log(`   Email: demo@example.com`);
		console.log('\n💡 Usage:');
		console.log('   Authorization: Bearer demo-session-token');
		console.log('━'.repeat(30));

		await client.end();
		process.exit(0);
	} catch (error) {
		console.error('❌ Error:', error);
		await client.end();
		process.exit(1);
	}
}

createDemoUser();
