import type { ZoneRecord } from '../../domain/entities.js';
import { pointInPolygon } from '../../domain/geo.js';
import type { ZoneRepository } from '../../ports.js';

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryZoneRepository implements ZoneRepository {
  private readonly byId = new Map<string, ZoneRecord>();

  async findByPoint(point: { lat: number; lng: number }): Promise<ZoneRecord | null> {
    for (const zone of this.byId.values()) {
      if (zone.isActive && pointInPolygon(point, zone.boundary)) return clone(zone);
    }
    return null;
  }

  async findById(id: string): Promise<ZoneRecord | null> {
    const zone = this.byId.get(id);
    return zone ? clone(zone) : null;
  }

  async findBySlug(slug: string): Promise<ZoneRecord | null> {
    for (const zone of this.byId.values()) if (zone.slug === slug) return clone(zone);
    return null;
  }

  async listActive(): Promise<ZoneRecord[]> {
    return [...this.byId.values()].filter((zone) => zone.isActive).map(clone);
  }

  async listAll(): Promise<ZoneRecord[]> {
    return [...this.byId.values()]
      .sort((a, b) => a.nameFa.localeCompare(b.nameFa, 'fa'))
      .map(clone);
  }

  async upsert(zone: ZoneRecord): Promise<ZoneRecord> {
    this.byId.set(zone.id, clone(zone));
    return clone(zone);
  }
}
