/**
 * Скрипт для применения SQL миграций (триггеры, RLS, функции)
 * к PostgreSQL базе данных
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set');
}

const sql = postgres(process.env.DATABASE_URL);

const SQL_FILES = [
	'000_session_config.sql',
	'001_helper_functions.sql',
	'002_trigger_functions.sql',
	'003_apply_triggers.sql',
	'005_drop_and_recreate_policies.sql'
];

async function applySqlMigrations() {
	console.log('🚀 Applying SQL migrations...\n');

	for (const filename of SQL_FILES) {
		const filepath = join(__dirname, '../drizzle/sql', filename);

		try {
			console.log(`📄 Reading ${filename}...`);
			const content = readFileSync(filepath, 'utf-8');

			console.log(`⚙️  Executing ${filename}...`);
			await sql.unsafe(content);

			console.log(`✅ ${filename} applied successfully\n`);
		} catch (error) {
			console.error(`❌ Error applying ${filename}:`, error);
			throw error;
		}
	}

	console.log('✅ All SQL migrations applied successfully!');
	await sql.end();
}

applySqlMigrations().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
