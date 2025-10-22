/**
 * Загрузка Collection Schemas в PostgreSQL
 *
 * Этот скрипт синхронизирует TypeScript коллекции с таблицей collection_schema в БД
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { collectionSchema } from '../src/lib/server/db/schema.js';
import { COLLECTIONS } from '../src/lib/collections.schema.js';
import { eq } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set');
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client, { schema: { collectionSchema } });

async function loadCollectionSchemas() {
	console.log('🚀 Loading collection schemas into database...\n');

	let loaded = 0;
	let updated = 0;
	let errors = 0;

	for (const [, schema] of Object.entries(COLLECTIONS)) {
		try {
			console.log(`📦 Processing: ${schema.collection_id}`);

			// Проверяем существующую схему
			const existing = await db
				.select()
				.from(collectionSchema)
				.where(eq(collectionSchema.collectionId, schema.collection_id))
				.limit(1);

			const data = {
				collectionId: schema.collection_id,
				baseTable: schema.base_table,
				filterRules: schema.filter || {},
				accessRules: schema.access_control,
				includes: schema.includes || null,
				fields: schema.fields,
				cacheStrategy: schema.cache_strategy,
				updatedAt: new Date()
			};

			if (existing.length > 0) {
				// Обновляем существующую схему
				await db
					.update(collectionSchema)
					.set(data)
					.where(eq(collectionSchema.collectionId, schema.collection_id));

				console.log(`   ✅ Updated: ${schema.collection_id}\n`);
				updated++;
			} else {
				// Создаем новую схему
				await db.insert(collectionSchema).values({
					...data,
					createdAt: new Date()
				});

				console.log(`   ✅ Inserted: ${schema.collection_id}\n`);
				loaded++;
			}
		} catch (error) {
			console.error(`   ❌ Error processing ${schema.collection_id}:`, error);
			errors++;
		}
	}

	console.log('━'.repeat(60));
	console.log(`✅ Collection schemas synchronized!`);
	console.log(`   📊 Statistics:`);
	console.log(`      - New schemas loaded: ${loaded}`);
	console.log(`      - Existing schemas updated: ${updated}`);
	console.log(`      - Errors: ${errors}`);
	console.log(`      - Total collections: ${Object.keys(COLLECTIONS).length}`);
	console.log('━'.repeat(60));

	process.exit(0);
}

loadCollectionSchemas().catch((error) => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});
