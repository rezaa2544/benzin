import type { UserRole } from '@benzin/shared';

/**
 * Panel authorisation mirror (task E8-01). The API is the enforcement point; this only
 * decides what the shell renders, so a mismatch degrades to a 403 instead of a leak.
 */

export const ROLE_RANK: Record<UserRole, number> = { USER: 0, SUPPORT: 1, ADMIN: 2, OWNER: 3 };

export type PageId =
  | 'dashboard'
  | 'users'
  | 'orders'
  | 'payments'
  | 'subscriptions'
  | 'settings'
  | 'sms'
  | 'zones'
  | 'audit'
  | 'status';

/** Pages a role may open. Support staff get the operational screens, not the money ones. */
export const PAGE_ACCESS: Record<PageId, readonly UserRole[]> = {
  dashboard: ['SUPPORT', 'ADMIN', 'OWNER'],
  users: ['SUPPORT', 'ADMIN', 'OWNER'],
  orders: ['SUPPORT', 'ADMIN', 'OWNER'],
  payments: ['ADMIN', 'OWNER'],
  subscriptions: ['ADMIN', 'OWNER'],
  settings: ['ADMIN', 'OWNER'],
  sms: ['ADMIN', 'OWNER'],
  zones: ['ADMIN', 'OWNER'],
  audit: ['SUPPORT', 'ADMIN', 'OWNER'],
  status: ['SUPPORT', 'ADMIN', 'OWNER'],
};

export const canAccess = (role: UserRole, page: PageId): boolean =>
  PAGE_ACCESS[page].includes(role);

export const canWriteUsers = (role: UserRole): boolean => ROLE_RANK[role] >= ROLE_RANK.ADMIN;

export const canEditSettings = (role: UserRole): boolean => ROLE_RANK[role] >= ROLE_RANK.ADMIN;

/** The owner account is invisible to plain admins (matches the API guard). */
export const canEditUser = (role: UserRole, targetRole: UserRole): boolean => {
  if (!canWriteUsers(role)) return false;
  if (targetRole === 'OWNER') return role === 'OWNER';
  return true;
};

export const defaultPageFor = (role: UserRole): PageId | null => {
  const order: PageId[] = [
    'dashboard',
    'users',
    'orders',
    'payments',
    'subscriptions',
    'settings',
    'sms',
    'zones',
    'audit',
    'status',
  ];
  return order.find((page) => canAccess(role, page)) ?? null;
};
