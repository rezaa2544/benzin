import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../../config.js';
import { SEED_PLANS, SEED_SETTINGS, SEED_ZONES } from './seed.js';
import { PgZoneRepository } from './repositories/zones.js';
import * as schema from './schema.js';
import { plans, settings } from './schema.js';

/**
 * Database lifecycle CLI (task E1-02).
 *
 *   pnpm db:migrate   apply every pending migration (forward-only)
 *   pnpm db:seed      idempotent seed: zones, plans, default settings
 *   pnpm db:reset     drop the schema and rebuild + seed (the only "down" in this project)
 *   pnpm db:status    show applied migrations
 *
 * Rollback policy: migrations are forward-only, so `reset` is the documented way back.
 * On production the equivalent is restore-from-backup (task E10-02), never `reset`.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../infra/migrations', import.meta.url));

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'status';
  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required for database commands');

  const client = new Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  const db = drizzle(client, { schema });

  try {
    switch (command) {
      case 'migrate': {
        await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
        console.info('migrations applied');
        break;
      }
      case 'seed': {
        await seed(db);
        console.info('seed applied');
        break;
      }
      case 'reset': {
        if (config.NODE_ENV === 'production') throw new Error('reset is refused in production');
        await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
        await client.query(
          'CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "postgis";',
        );
        await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
        await seed(db);
        console.info('database reset, migrated and seeded');
        break;
      }
      case 'status': {
        const files = readdirSync(MIGRATIONS_DIR)
          .filter((name) => name.endsWith('.sql'))
          .sort();
        const applied = await client
          .query<{ hash: string; created_at: string }>(
            'select hash, created_at from drizzle.__drizzle_migrations order by created_at',
          )
          .catch(() => ({ rows: [] as { hash: string; created_at: string }[] }));
        console.info(`files:   ${files.join(', ') || '(none)'}`);
        console.info(`applied: ${applied.rows.length}`);
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}. Use migrate|seed|reset|status.`);
    }
  } finally {
    await client.end();
  }
}

async function seed(db: NodePgDatabase<typeof schema>): Promise<void> {
  const zones = new PgZoneRepository(db);
  for (const zone of SEED_ZONES) await zones.upsert(zone);

  for (const plan of SEED_PLANS) {
    await db
      .insert(plans)
      .values({
        code: plan.code,
        nameFa: plan.nameFa,
        durationDays: plan.durationDays,
        priceToman: plan.priceToman,
        maxActiveOrders: plan.maxActiveOrders,
        isActive: plan.isActive,
      })
      .onConflictDoUpdate({
        target: plans.code,
        set: {
          nameFa: plan.nameFa,
          durationDays: plan.durationDays,
          priceToman: plan.priceToman,
          maxActiveOrders: plan.maxActiveOrders,
          isActive: plan.isActive,
        },
      });
  }

  for (const [key, value] of Object.entries(SEED_SETTINGS)) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing({ target: settings.key });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
void sql;
