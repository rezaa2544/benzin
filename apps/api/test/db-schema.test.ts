import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '@benzin/shared';
import { BANEH_ZONE, SEED_PLANS, SEED_SETTINGS } from '../src/infra/db/seed.js';
import { pointInPolygon, ringToWktPolygon } from '../src/domain/geo.js';

/**
 * Offline guards for the data layer (tasks E1-02 / E2-01). They do not need a running Postgres:
 * they assert that the generated migration still contains the constraints the domain relies on,
 * and that the seed data obeys those constraints.
 */

const migrationsDir = fileURLToPath(new URL('../../../infra/migrations', import.meta.url));
const sql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(`${migrationsDir}/${name}`, 'utf8'))
  .join('\n');

const schemaSource = readFileSync(
  fileURLToPath(new URL('../src/infra/db/schema.ts', import.meta.url)),
  'utf8',
);

const tablesInSchema = [...schemaSource.matchAll(/pgTable\(\s*'([a-z_]+)'/g)].map(
  (match) => match[1]!,
);

describe('generated migrations', () => {
  it('creates every table declared in the Drizzle schema', () => {
    expect(tablesInSchema.length).toBeGreaterThanOrEqual(21);
    for (const table of tablesInSchema) {
      expect(sql, `missing table ${table}`).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('keeps the partial unique index that guarantees one live reservation per order', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "reservations_one_active_per_order"');
    expect(sql).toMatch(/WHERE status IN \('PENDING_OWNER', 'CONFIRMED'\)/);
  });

  it('keeps the GiST indexes for geo lookups', () => {
    expect(sql).toContain('CREATE INDEX "zones_boundary_gist" ON "zones" USING gist');
    expect(sql).toContain('CREATE INDEX "orders_location_gist" ON "orders" USING gist');
  });

  it('keeps the open-order search index and the pending-payment uniqueness', () => {
    expect(sql).toContain('"orders_open_search_idx"');
    expect(sql).toContain('"payments_unique_amount_idx"');
  });

  // E3-01: the search index must match the query the API actually sends, otherwise Postgres
  // silently falls back to a sequential scan. Leading columns follow the equality filters.
  it('shapes the search index like the search query', () => {
    const line = sql.split('\n').find((row) => row.includes('"orders_open_search_idx"'))!;
    expect(line).toContain('("zone_id","side","tier","rate_toman","created_at")');
    expect(line).toContain("WHERE status = 'OPEN'");
  });

  it('keeps an expiry index for the open-order sweep', () => {
    const line = sql.split('\n').find((row) => row.includes('"orders_expiry_idx"'))!;
    expect(line).toContain('("expires_at")');
    expect(line).toContain("WHERE status = 'OPEN'");
  });

  // E5-01/E5-02: the message kind drives client rendering (text bubble vs contact card).
  it('guards the chat message kind and keeps idempotency indexes', () => {
    expect(sql).toContain(
      'ALTER TABLE "messages" ADD COLUMN "kind" text DEFAULT \'TEXT\' NOT NULL',
    );
    expect(sql).toContain('"messages_kind_check"');
    expect(sql).toMatch(/CHECK \("messages"\."kind" IN \('TEXT', 'CONTACT', 'SYSTEM'\)\)/);
    expect(sql).toContain('CREATE UNIQUE INDEX "messages_conversation_client_idx"');
    expect(sql).toContain('CREATE INDEX "messages_conversation_idx" ON "messages"');
  });

  // E5-03: the inbox filters unread rows per user, so the partial index must stay.
  it('stores the notification template kind and the unread index', () => {
    expect(sql).toContain(
      'ALTER TABLE "notifications" ADD COLUMN "kind" text DEFAULT \'SYSTEM\' NOT NULL',
    );
    const unreadIndex = sql
      .split('\n')
      .find((row) => row.includes('"notifications_user_unread_idx"'))!;
    expect(unreadIndex).toContain('("user_id","created_at")');
    expect(unreadIndex).toContain('WHERE read_at IS NULL');
  });

  it('declares the PostGIS extension before the geography columns', () => {
    const extensionAt = sql.indexOf('CREATE EXTENSION IF NOT EXISTS "postgis"');
    const geographyAt = sql.indexOf('geography(');
    expect(extensionAt).toBeGreaterThan(-1);
    expect(geographyAt).toBeGreaterThan(extensionAt);
  });
});

describe('seed data', () => {
  it('covers Baneh with a valid polygon', () => {
    expect(BANEH_ZONE.boundary.length).toBeGreaterThanOrEqual(3);
    expect(BANEH_ZONE.slug).toMatch(/^[a-z0-9-]+$/);
    expect(pointInPolygon({ lat: 35.998, lng: 45.885 }, BANEH_ZONE.boundary)).toBe(true);
    expect(ringToWktPolygon(BANEH_ZONE.boundary)).toMatch(/^POLYGON\(\(.+\)\)$/);
  });

  it('seeds one default value for every runtime setting', () => {
    expect(Object.keys(SEED_SETTINGS).sort()).toEqual([...SETTING_KEYS].sort());
  });

  it('seeds plans with sane prices and durations', () => {
    expect(SEED_PLANS.length).toBeGreaterThanOrEqual(2);
    for (const plan of SEED_PLANS) {
      expect(plan.durationDays).toBeGreaterThan(0);
      expect(plan.priceToman).toBeGreaterThan(0);
      expect(plan.code).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
