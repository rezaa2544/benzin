import type { UserRole, UserStatus } from '@benzin/shared';

/** Wire types for the admin endpoints (epic E8). Mirrors `apps/api/src/modules/admin-service.ts`. */

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface UserRow {
  id: string;
  phone: string;
  displayName: string | null;
  role: UserRole;
  roleFa: string;
  status: UserStatus;
  suspendedUntil: string | null;
  createdAt: string;
}

export interface UserDetail extends UserRow {
  reputation: { score: number; level: string; levelFa: string };
  counts: { orders: number; reservations: number; payments: number; subscriptions: number };
  subscription: { planCode: string | null; status: string; endsAt: string } | null;
}

export interface OrderRow {
  id: string;
  ownerId: string;
  ownerPhone: string | null;
  side: string;
  tier: string;
  litres: number;
  rateToman: number;
  totalToman: number;
  status: string;
  zoneId: string;
  stationName: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface OrderDetail extends OrderRow {
  note: string | null;
  reservations: {
    id: string;
    takerId: string;
    takerPhone: string | null;
    status: string;
    createdAt: string;
    decidedAt: string | null;
    completedAt: string | null;
    cancelReason: string | null;
  }[];
}

export interface PaymentRow {
  id: string;
  status: string;
  provider: string;
  amountToman: number;
  uniqueAmountToman: number | null;
  reference: string | null;
  paidAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface PaymentCardRow {
  id: string;
  maskedNumber: string;
  last4: string;
  holderName: string;
  bankName: string | null;
  isActive: boolean;
  dailyLimit: number | null;
}

export interface SubscriptionRow {
  id: string;
  userId: string;
  phone: string | null;
  planCode: string | null;
  planNameFa: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Dashboard {
  users: { total: number; active: number; suspended: number; banned: number };
  orders: { byStatus: Record<string, number>; open: number; completed: number };
  reservations: { active: number };
  subscriptions: { active: number; pending: number };
  payments: {
    paidCount: number;
    paidToman: number;
    pendingCount: number;
    failedCount: number;
    expiredCount: number;
  };
  tiles: { labelFa: string; value: string; hintFa: string }[];
  recentAudit: AuditRow[];
  generatedAt: string;
}

export interface SystemStatus {
  mode: string;
  nodeEnv: string;
  version: string;
  uptimeSeconds: number;
  serverTime: string;
  checks: { name: string; ok: boolean; detailFa: string }[];
  providers: { kind: string; provider: string; isActive: boolean }[];
  settingsKeys: number;
}

export interface ProviderRow {
  id: string;
  provider: string;
  kind: 'SMS' | 'PAYMENT' | 'MAP';
  isActive: boolean;
  config: Record<string, unknown>;
}

export interface ZoneRow {
  id: string;
  slug: string;
  nameFa: string;
  city: string;
  province: string;
  isActive: boolean;
  vertices: number;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; phone: string; displayName: string | null; role: UserRole };
}
