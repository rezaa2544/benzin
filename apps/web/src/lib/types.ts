import type {
  DeliveryMethod,
  OrderSide,
  OrderStatus,
  ReservationStatus,
  Tier,
  UserRole,
} from '@benzin/shared';

export interface PublicUser {
  id: string;
  phone: string;
  displayName: string | null;
  role: UserRole;
  createdAt?: string;
}

export interface ZoneView {
  id: string;
  slug: string;
  nameFa: string;
  city: string;
  province: string;
  boundary: Array<[number, number]>;
}

export interface RouteEstimate {
  distanceKm: number;
  durationMinutes: number;
}

export interface OrderView {
  id: string;
  ownerId: string;
  side: OrderSide;
  tier: Tier;
  litres: number;
  rateToman: number;
  officialRateToman: number;
  totalToman: number;
  buyerSavingToman: number;
  status: OrderStatus;
  stationName: string | null;
  note: string | null;
  location: { lat: number; lng: number } | null;
  deliveryMethod: DeliveryMethod;
  expiresAt: string;
  createdAt: string;
  distance?: RouteEstimate;
}

export interface OrderList {
  items: OrderView[];
  nextCursor: string | null;
}

export interface ReservationView {
  id: string;
  orderId: string;
  takerId: string;
  status: ReservationStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
}

export interface MarketStats {
  zoneId: string;
  side: OrderSide;
  tier: Tier;
  windowDays: number;
  sampleSize: number;
  excludedSuspicious: number;
  medianRateToman: number | null;
  p25RateToman: number | null;
  p75RateToman: number | null;
  minRateToman: number | null;
  maxRateToman: number | null;
}

export interface MetaConfig {
  otpTtlSeconds: number;
  otpLength: number;
  reservationTtlMinutes: number;
  ownerDecisionTtlMinutes: number;
  minLitres: number;
  maxLitres: number;
  maxActiveReservations: number;
  maxMessageLength: number;
  quickReplies: string[];
}

export interface NotificationView {
  id: string;
  kind: string;
  channel: 'IN_APP' | 'SMS' | 'PUSH';
  titleFa: string;
  bodyFa: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: NotificationView[];
  unreadCount: number;
}

export interface OtpRequestResult {
  expiresAt: string;
  cooldownSeconds: number;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  deviceId: string;
  isNewUser: boolean;
  user: PublicUser;
}

export interface PlanView {
  id: string;
  code: string;
  nameFa: string;
  priceToman: number;
  priceLabelFa: string;
  durationDays: number;
  maxActiveOrders: number;
}

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface SubscriptionView {
  id: string;
  planId: string;
  planCode: string;
  planNameFa: string;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  daysRemaining: number;
}

export interface PaymentView {
  id: string;
  amountToman: number;
  status: string;
  method: 'CARD_TO_CARD' | 'GATEWAY';
  expiresAt: string;
  createdAt: string;
}

export interface PaymentStartView extends PaymentView {
  redirectUrl: string | null;
  destination: { cardNumber: string; holderName: string; bankName: string | null } | null;
  instructionFa: string;
}

export interface ConversationView {
  id: string;
  orderId: string;
  createdAt: string;
  closedAt: string | null;
  writable: boolean;
  contactAllowed: boolean;
  peer: { id: string; displayName: string | null };
  unreadCount: number;
  lastMessage: { body: string; kind: string; senderId: string; createdAt: string } | null;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  kind: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  contactMasked?: boolean;
}

export interface RatingView {
  id: string;
  reservationId: string;
  raterId: string;
  subjectId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
}

export interface ReputationEventView {
  id: string;
  kind: string;
  labelFa: string;
  delta: number;
  orderId: string | null;
  createdAt: string;
}

export interface ReputationSummary {
  userId: string;
  score: number;
  level: string;
  levelFa: string;
  completedTrades: number;
  cancelledTrades: number;
  disputes: number;
  ratingCount: number;
  averageStars: number | null;
  suspendedUntil: string | null;
  recentEvents: ReputationEventView[];
}

export interface DeviceView {
  id: string;
  platform: string;
  deviceId: string;
  appVersion: string | null;
  lastSeenAt: string;
}
