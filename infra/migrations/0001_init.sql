-- Benzin — initial schema (brief §5).
-- Postgres 16 + PostGIS. Forward-only migration; every statement is idempotent-safe on a fresh DB.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ---------------------------------------------------------------- enums
CREATE TYPE user_role      AS ENUM ('USER', 'SUPPORT', 'ADMIN', 'OWNER');
CREATE TYPE user_status    AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');
CREATE TYPE tier_type      AS ENUM ('T1500', 'T3000', 'T10000');
CREATE TYPE order_side     AS ENUM ('SELL', 'BUY');
CREATE TYPE order_status   AS ENUM
  ('OPEN', 'RESERVED', 'CONFIRMED', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'AWAITING_OWNER_DECISION', 'DISPUTED');
CREATE TYPE reservation_status AS ENUM
  ('PENDING_OWNER', 'CONFIRMED', 'COMPLETED', 'AUTO_COMPLETED', 'DISPUTED', 'EXPIRED',
   'CANCELLED_BY_TAKER', 'CANCELLED_BY_OWNER', 'REJECTED');
CREATE TYPE delivery_method AS ENUM ('FUEL_CARD');
CREATE TYPE payment_provider AS ENUM ('CARD_TO_CARD', 'GATEWAY');
CREATE TYPE payment_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'NEEDS_REVIEW');
CREATE TYPE subscription_status AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING');
CREATE TYPE notification_channel AS ENUM ('PUSH', 'SMS', 'IN_APP');
CREATE TYPE report_status AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          text NOT NULL UNIQUE CHECK (phone ~ '^09[0-9]{9}$'),
  display_name   text,
  role           user_role NOT NULL DEFAULT 'USER',
  status         user_status NOT NULL DEFAULT 'ACTIVE',
  wallet_balance bigint NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  reputation     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  device_id   text NOT NULL,
  push_token  text,
  app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  device_id   uuid REFERENCES devices(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_active_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone, sent_at DESC);

-- ---------------------------------------------------------------- geography
CREATE TABLE zones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_fa      text NOT NULL,
  slug         text NOT NULL UNIQUE,
  boundary     geography(POLYGON, 4326) NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  city         text NOT NULL,
  province     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zones_boundary_gist ON zones USING GIST (boundary);

-- ---------------------------------------------------------------- trading
CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  side            order_side NOT NULL,
  tier            tier_type NOT NULL,
  litres          numeric(10, 2) NOT NULL CHECK (litres > 0),
  rate_toman      integer NOT NULL CHECK (rate_toman > 0),
  zone_id         uuid NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  station_name    text,
  note            text,
  location        geography(POINT, 4326),
  delivery_method delivery_method NOT NULL DEFAULT 'FUEL_CARD',
  status          order_status NOT NULL DEFAULT 'OPEN',
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Hot path: "open orders in my zone, for this tier and side, cheapest first".
CREATE INDEX orders_open_search_idx
  ON orders (zone_id, side, tier, rate_toman, created_at DESC)
  WHERE status = 'OPEN';
CREATE INDEX orders_owner_idx ON orders (owner_id, created_at DESC);
CREATE INDEX orders_location_gist ON orders USING GIST (location);
CREATE INDEX orders_expiry_idx ON orders (expires_at) WHERE status = 'OPEN';

CREATE TABLE order_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity   numeric(10, 2) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  taker_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status        reservation_status NOT NULL DEFAULT 'PENDING_OWNER',
  message       text,
  cancel_reason text,
  expires_at    timestamptz NOT NULL,
  decided_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- The database-level guarantee behind the concurrency test: at most one live reservation per order.
CREATE UNIQUE INDEX reservations_one_active_per_order
  ON reservations (order_id)
  WHERE status IN ('PENDING_OWNER', 'CONFIRMED');
CREATE INDEX reservations_taker_active_idx
  ON reservations (taker_id)
  WHERE status IN ('PENDING_OWNER', 'CONFIRMED');
CREATE INDEX reservations_pending_expiry_idx ON reservations (expires_at) WHERE status = 'PENDING_OWNER';
CREATE INDEX reservations_order_idx ON reservations (order_id, created_at DESC);

CREATE TABLE trades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  seller_id      uuid NOT NULL REFERENCES users(id),
  buyer_id       uuid NOT NULL REFERENCES users(id),
  tier           tier_type NOT NULL,
  litres         numeric(10, 2) NOT NULL,
  rate_toman     integer NOT NULL,
  total_toman    integer NOT NULL,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (seller_id <> buyer_id)
);
CREATE INDEX trades_seller_idx ON trades (seller_id, created_at DESC);
CREATE INDEX trades_buyer_idx ON trades (buyer_id, created_at DESC);

-- ---------------------------------------------------------------- messaging
CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users(id),
  body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  client_message_id uuid,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, client_message_id)
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);

-- ---------------------------------------------------------------- trust & safety
CREATE TABLE reputation_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  delta      integer NOT NULL,
  order_id   uuid REFERENCES orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reputation_events_user_idx ON reputation_events (user_id, created_at DESC);

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  order_id    uuid REFERENCES orders(id) ON DELETE SET NULL,
  reason      text NOT NULL,
  details     text,
  status      report_status NOT NULL DEFAULT 'OPEN',
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- ---------------------------------------------------------------- monetisation
CREATE TABLE plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name_fa       text NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  price_toman   integer NOT NULL CHECK (price_toman >= 0),
  max_active_orders smallint NOT NULL DEFAULT 2,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id    uuid NOT NULL REFERENCES plans(id),
  status     subscription_status NOT NULL DEFAULT 'PENDING',
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX subscriptions_user_active_idx ON subscriptions (user_id, ends_at DESC) WHERE status = 'ACTIVE';

CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider       payment_provider NOT NULL,
  status         payment_status NOT NULL DEFAULT 'PENDING',
  amount_toman   integer NOT NULL CHECK (amount_toman > 0),
  authority      text,
  reference      text,
  unique_amount  integer,
  raw_payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at        timestamptz,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_unique_amount_idx ON payments (unique_amount) WHERE status = 'PENDING';
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);

CREATE TABLE payment_cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_number text NOT NULL,
  holder_name text NOT NULL,
  bank_name   text,
  is_active   boolean NOT NULL DEFAULT true,
  daily_limit integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- platform configuration
CREATE TABLE provider_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider   text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('SMS', 'PAYMENT', 'PUSH', 'MAP', 'STORAGE')),
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active  boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, provider)
);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel    notification_channel NOT NULL DEFAULT 'IN_APP',
  title_fa   text NOT NULL,
  body_fa    text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  sent_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip         inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
