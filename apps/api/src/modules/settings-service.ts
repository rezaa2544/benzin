import {
  DEFAULT_SETTINGS,
  parseSetting,
  SETTING_KEYS,
  type SettingKey,
  type Settings,
} from '@benzin/shared';
import { AppError } from '@benzin/shared';
import type { Repositories } from '../ports.js';

export class SettingsService {
  private cache: { settings: Settings; loadedAt: number } | null = null;

  constructor(
    private readonly repos: Pick<Repositories, 'settings' | 'audit'>,
    private readonly cacheTtlMs = 15_000,
  ) {}

  /** Effective settings: persisted overrides layered over the compiled-in defaults. */
  async get(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.cacheTtlMs)
      return this.cache.settings;
    const records = await this.repos.settings.findAll();
    const effective: Settings = { ...DEFAULT_SETTINGS };
    for (const record of records) {
      if (!(record.key in DEFAULT_SETTINGS)) continue;
      try {
        (effective as Record<string, unknown>)[record.key] = parseSetting(
          record.key as SettingKey,
          record.value,
        );
      } catch {
        // A corrupt row must never take the platform down: fall back to the default value.
      }
    }
    this.cache = { settings: effective, loadedAt: Date.now() };
    return effective;
  }

  async update(
    actorId: string,
    patch: Record<string, unknown>,
  ): Promise<{ key: SettingKey; value: unknown }[]> {
    const entries = Object.entries(patch);
    if (entries.length === 0) throw AppError.validation('No settings provided');

    const parsed: { key: SettingKey; value: unknown }[] = [];
    for (const [key, raw] of entries) {
      if (!(key in DEFAULT_SETTINGS)) {
        throw AppError.validation('Unknown setting key', { key, allowed: SETTING_KEYS });
      }
      try {
        parsed.push({ key: key as SettingKey, value: parseSetting(key as SettingKey, raw) });
      } catch {
        throw AppError.validation('Invalid setting value', { key });
      }
    }

    for (const { key, value } of parsed) {
      await this.repos.settings.set(key, value, actorId);
      await this.repos.audit.append({
        actorId,
        action: 'settings.updated',
        entity: 'settings',
        entityId: key,
        metadata: { value },
      });
    }
    this.cache = null;
    return parsed;
  }

  invalidate(): void {
    this.cache = null;
  }
}
