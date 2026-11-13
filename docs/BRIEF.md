# بنزین — نقشه‌ی مهندسی (برگرفته از Master Brief)

این سند، نسخه‌ی اجراییِ Master Brief است که برای مخزن بازنویسی شده: هر جا بریف اصلی جزئیاتی
داشته که در کد لازم بوده، اینجا آمده و هر جا بریف صریح نبوده، پیش‌فرض در
[`ASSUMPTIONS.md`](ASSUMPTIONS.md) ثبت شده است. نام پروژه **بنزین / benzin** است؛
هر اشاره‌ی بریف به «پایش / Payesh» اشتباه است و نادیده گرفته شده.

## ۱. محصول در یک بند

صاحب خودرو سهمیه‌ی سوخت استفاده‌نشده‌اش را با قیمتی کمتر از نرخ رسمی می‌فروشد؛ خریدار آن را
رزرو می‌کند، صاحب سفارش تأیید می‌کند، دو طرف در چت هماهنگ می‌کنند و بعد از تحویل، معامله
تکمیل می‌شود. سه سطح سهمیه (۱۵۰۰، ۳۰۰۰، ۱۰۰۰۰) و سه نقش: کاربر، پشتیبانی، مدیر.

## ۲. معماری

| لایه         | انتخاب                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------ |
| API          | NestJS-style modular monolith روی **Fastify 5** ([ADR-0001](ADR/0001-modular-monolith.md)) |
| داده         | **Drizzle ORM**، **Postgres 16 + PostGIS**، مهاجرت‌های SQL پیش‌رو                          |
| صف/زمان‌بندی | **Redis 7 + BullMQ** (انقضای سفارش و رزرو، اعلان، پاکسازی)                                 |
| زمان‌واقعی   | `ws` برای چت و به‌روزرسانی زنده‌ی سفارش                                                    |
| اعتبارسنجی   | **Zod**، اسکیماهای مشترک در `packages/shared`                                              |
| وب           | React 18 + Vite + Tailwind + shadcn/ui، PWA برای iOS                                       |
| موبایل       | Capacitor (اندروید) با همان باندل وب                                                       |
| پنل          | SPA جدا (`apps/admin`) با همان Design System                                               |
| استقرار      | Docker Compose + **Caddy** روی یک VPS (ریورس‌پروکسی و TLS)                                 |

مرزهای سرور: `http` → `modules` → `domain`؛ دسترسی به داده فقط از `ports` و پیاده‌سازی‌های
`infra`. هیچ ماژولی به ماژول دیگر import مستقیم ندارد.

## ۳. مدل داده

`users`, `devices`, `refresh_tokens`, `zones`, `orders`, `order_items`, `reservations`,
`trades`, `conversations`, `messages`, `reputation_events`, `plans`, `subscriptions`,
`payments`, `payment_cards`, `provider_settings`, `settings`, `notifications`, `reports`,
`audit_logs` — تعریف دقیق ستون‌ها در [`infra/migrations/0001_init.sql`](../infra/migrations/0001_init.sql).

ایندکس‌های حساس (بدون این‌ها معامله‌ی هم‌زمان می‌شکند):

- `reservations_one_active_per_order` — ایندکس **یکتای جزئی** روی `order_id` برای وضعیت‌های
  `PENDING_OWNER | CONFIRMED`: هر سفارش در هر لحظه حداکثر یک رزرو زنده دارد.
- `orders_open_search_idx` — جزئی روی `status = 'OPEN'` با `(zone_id, side, tier, rate_toman, created_at DESC)`.
- `orders_location_gist` / `zones_boundary_gist` — **GiST** برای نزدیکی و «داخل محدوده‌ی شهر».
- `orders_expiry_idx`, `reservations_pending_expiry_idx` — اسکن انقضا.
- `payments_unique_amount_idx` — مبلغ یکتای در انتظار، برای تأیید کارت‌به‌کارت.

## ۴. ماشین حالت

```
سفارش:    OPEN ──RESERVE(خریدار)──▶ RESERVED ──CONFIRM(صاحب سفارش)──▶ CONFIRMED ──COMPLETE──▶ COMPLETED
            │                          │                                  │
            │ EXPIRE                   │ RELEASE                          ├─ OWNER_UNRESPONSIVE ─▶ AWAITING_OWNER_DECISION
            ▼                          ▼                                  └─ DISPUTE ─▶ DISPUTED ─(ادمین)─▶ COMPLETED/CANCELLED
         EXPIRED                     OPEN(آزاد)
```

قواعد غیرقابل‌عبور:

1. تأیید فقط توسط صاحب سفارش (`RESERVED → CONFIRMED`).
2. رهاسازی خودکار بر اساس زمان: `PENDING_OWNER → EXPIRED` و آزادسازی سفارش.
3. هیچ کاربری نمی‌تواند سفارش خودش را رزرو کند (`TRADE_CYCLE_BLOCKED`).
4. تکمیل از طرف هر دو طرف ممکن است؛ اختلاف فقط با ادمین بسته می‌شود.
5. پایان رزرو همیشه سفارش را یا به `CONFIRMED` می‌برد یا به `OPEN`/`CANCELLED` — هرگز معلق.

جدول گذارها در `packages/shared/src/state-machine.ts` است و تنها راه مجاز تغییر وضعیت.

## ۵. تنظیمات زمان اجرا

همه از پنل ادمین و بدون استقرار تغییر می‌کنند (`packages/shared/src/settings.ts`):
`reservation.ttl_minutes`, `reservation.max_active_per_user`, `owner.decision_ttl_minutes`,
`order.max_open_per_user`, `order.min_litres`, `order.max_litres`, `order.default_expiry_hours`,
`order.rate_ceiling_tolerance_percent`, `trade.auto_complete_hours`, `chat.max_message_length`,
`chat.quick_replies`, `otp.length`, `otp.ttl_seconds`, `otp.max_attempts`,
`otp.resend_cooldown_seconds`, `auth.refresh_token_days`, `pricing.low_price_warning_percent`,
`dispute.auto_review_hours`, `geo.default_radius_km`.

هر کلید سقف/کف دارد؛ مقدار خراب در پایگاه‌داده نادیده گرفته می‌شود و پیش‌فرض اعمال می‌شود.

## ۶. تجربه‌ی کاربری و پنل (فارسی، RTL)

- فونت **Vazirmatn** خودمیزبان (بدون CDN خارجی)، وزن ۴۰۰/۵۰۰/۷۰۰.
- RTL با ویژگی‌های منطقی CSS (`margin-inline-start`, `padding-inline-end`, `inset-inline`).
  هیچ `left/right` مستقیم در استایل‌ها.
- همه‌ی اعداد با ارقام فارسی، مبالغ با `formatToman` و جداکننده‌ی «٬»، حجم با «٫» اعشار.
- تاریخ شمسی و منطقه‌ی زمانی `Asia/Tehran` با `Intl` — بدون وابستگی اضافه.
- توکن‌های رنگ و فاصله در `apps/web/src/styles/tokens.css`؛ ابتدا **Style Guide** با
  تأیید اسکرین‌شات (E9-02) و بعد صفحه‌ها.
- کامپوننت‌های پایه: AppShell, BottomNav, OrderCard, TierBadge, PriceTag, CountdownRing,
  EmptyState, ConfirmSheet, ChatBubble, Toast, FormField, OtpInput.
- هر متن از `i18n/fa.json`؛ هیچ رشته‌ی فارسی hardcode در کامپوننت‌ها.

## ۷. فازها

| فاز | محتوا                                                                 |
| --- | --------------------------------------------------------------------- |
| M0  | مخزن و CI، ورود OTP، اسکیمای داده، Spike ارائه‌دهنده‌ها               |
| M1  | سفارش، جستجو، رزرو، ماشین حالت، چت، صف و انقضا، اعلان                 |
| M2  | پلن و اشتراک، پرداخت، اعتبار و گزارش، زیرساخت عملیاتی                 |
| M3  | پنل مدیریت، کلاینت طراحی و PWA/Capacitor، استقرار و لانچ آزمایشی بانه |

## ۸. Definition of Done هر تسک

1. کد با TypeScript سختگیر و بدون `any`، پیام‌ها و کامیت انگلیسی.
2. تست واحد برای قواعد و تست یکپارچه برای مسیر HTTP؛ تست هم‌زمانی برای هر تغییر وضعیت
   سفارش/رزرو (نمونه: ۵۰ درخواست هم‌زمان → یک برنده).
3. خطاها با کد ثابت و پاکت یکسان؛ هیچ متن فارسی در API.
4. مهاجرت/تنظیمات/متغیر محیطی مستند و بدون رمز در گیت.
5. `pnpm -r build && pnpm -r test` سبز؛ سپس PR و ادغام توسط خود عامل.
