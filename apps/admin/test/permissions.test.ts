import { describe, expect, it } from 'vitest';
import {
  canAccess,
  canEditSettings,
  canEditUser,
  canWriteUsers,
  defaultPageFor,
} from '../src/lib/permissions.js';

describe('panel permissions (E8-01)', () => {
  it('keeps money screens away from support staff', () => {
    expect(canAccess('SUPPORT', 'orders')).toBe(true);
    expect(canAccess('SUPPORT', 'payments')).toBe(false);
    expect(canAccess('SUPPORT', 'settings')).toBe(false);
    expect(canAccess('ADMIN', 'payments')).toBe(true);
  });

  it('only the owner may touch an owner account', () => {
    expect(canEditUser('ADMIN', 'OWNER')).toBe(false);
    expect(canEditUser('OWNER', 'OWNER')).toBe(true);
    expect(canEditUser('SUPPORT', 'USER')).toBe(false);
    expect(canEditUser('ADMIN', 'USER')).toBe(true);
  });

  it('gives every staff role a landing page', () => {
    expect(defaultPageFor('SUPPORT')).toBe('dashboard');
    expect(defaultPageFor('ADMIN')).toBe('dashboard');
    expect(defaultPageFor('USER')).toBeNull();
    expect(canWriteUsers('ADMIN')).toBe(true);
    expect(canEditSettings('SUPPORT')).toBe(false);
  });
});
