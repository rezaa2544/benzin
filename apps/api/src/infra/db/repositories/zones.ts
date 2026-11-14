import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema.js';
import type { ZoneRecord } from '../../../domain/entities.js';
import { pointInPolygon } from '../../../domain/geo.js';
import type { ZoneRepository } from '../../../ports.js';
import { zones } from '../schema.js';

/**
 * Postgres-backed zone lookup (task E2-01). The containment test runs inside the database so
 * the GiST index on `zones.boundary` does the work instead of the API process.
 */

type Row = {
  id: string;
  slug: string;
  nameFa: string;
  city: string;
  province: string;
  isActive: boolean;
  boundaryGeo: string;
};

const parseRing = (geoJson: string): (readonly [number, number])[] => {
  const parsed = JSON.parse(geoJson) as { type: string; coordinates: number[][][] };
  const ring = parsed.coordinates[0] ?? [];
  return ring.map((pair) => [pair[0] ?? 0, pair[1] ?? 0] as const);
};

const toRecord = (row: Row): ZoneRecord => ({
  id: row.id,
  slug: row.slug,
  nameFa: row.nameFa,
  city: row.city,
  province: row.province,
  isActive: row.isActive,
  boundary: parseRing(row.boundaryGeo),
});

export class PgZoneRepository implements ZoneRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  private baseQuery() {
    return this.db
      .select({
        id: zones.id,
        slug: zones.slug,
        nameFa: zones.nameFa,
        city: zones.city,
        province: zones.province,
        isActive: zones.isActive,
        boundaryGeo: sql<string>`ST_AsGeoJSON(${zones.boundary})`,
      })
      .from(zones);
  }

  async findByPoint(point: { lat: number; lng: number }): Promise<ZoneRecord | null> {
    const rows = await this.baseQuery()
      .where(
        and(
          eq(zones.isActive, true),
          sql`ST_Contains(${zones.boundary}::geometry, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326))`,
        ),
      )
      .limit(1);

    const row = rows[0] as Row | undefined;
    if (row) return toRecord(row);

    // Fallback for a database without PostGIS (developer ran migrations on plain Postgres):
    // test containment in-process instead of failing the request.
    const active = await this.listActive();
    return active.find((zone) => pointInPolygon(point, zone.boundary)) ?? null;
  }

  async findById(id: string): Promise<ZoneRecord | null> {
    const rows = await this.baseQuery().where(eq(zones.id, id)).limit(1);
    const row = rows[0] as Row | undefined;
    return row ? toRecord(row) : null;
  }

  async findBySlug(slug: string): Promise<ZoneRecord | null> {
    const rows = await this.baseQuery().where(eq(zones.slug, slug)).limit(1);
    const row = rows[0] as Row | undefined;
    return row ? toRecord(row) : null;
  }

  async listActive(): Promise<ZoneRecord[]> {
    const rows = await this.baseQuery().where(eq(zones.isActive, true));
    return (rows as Row[]).map(toRecord);
  }

  async listAll(): Promise<ZoneRecord[]> {
    const rows = await this.db
      .select({
        id: zones.id,
        slug: zones.slug,
        nameFa: zones.nameFa,
        city: zones.city,
        province: zones.province,
        isActive: zones.isActive,
        boundaryGeo: sql<string>`ST_AsGeoJSON(${zones.boundary})`,
      })
      .from(zones)
      .orderBy(zones.nameFa);
    return (rows as Row[]).map(toRecord);
  }

  async upsert(zone: ZoneRecord): Promise<ZoneRecord> {
    const wkt = `SRID=4326;POLYGON((${zone.boundary
      .map(([lng, lat]) => `${lng} ${lat}`)
      .join(',')}))`;
    await this.db
      .insert(zones)
      .values({
        id: zone.id,
        slug: zone.slug,
        nameFa: zone.nameFa,
        city: zone.city,
        province: zone.province,
        isActive: zone.isActive,
        boundary: sql`ST_GeogFromText(${wkt})` as never,
      })
      .onConflictDoUpdate({
        target: zones.id,
        set: {
          nameFa: zone.nameFa,
          city: zone.city,
          province: zone.province,
          isActive: zone.isActive,
          boundary: sql`ST_GeogFromText(${wkt})` as never,
        },
      });
    return zone;
  }
}
