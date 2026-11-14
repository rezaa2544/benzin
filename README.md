# بنزین · Benzin

دوست‌یار خرید و فروش سهمیه سوخت. سهمیه آزاد سوخت خود را به کسی که نیاز دارد می‌رسانیم — با ثبت سفارش،
رزرو، تأیید صاحب سفارش، چت و تسویه، و یک پنل مدیریت کامل.

> **Benzin** is a marketplace for Iran's subsidised fuel quota: owners list their unused litres,
> buyers reserve them, the owner accepts, both sides coordinate in-app and confirm the hand-over.
> Persian UI, RTL, Jalali dates, Toman amounts — English code and commits.

## وضعیت پروژه

| قطعه                          | وضعیت                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| تابلوی وظایف (Notion «بنزین») | ۷۴ تسک در E0…E10 + ۱۰ تصمیم باز + Spike ارائه‌دهندگان                                                                                                                                                                                                                                                                                                |
| `packages/shared`             | ✅ قواعد دامنه‌ی مشترک، اسکیمای Zod، تنظیمات پیش‌فرض، ماشین حالت، قالب‌بندی فارسی، قالب‌های اعلان، ماسک تماس — ۵۵ تست                                                                                                                                                                                                                                |
| `apps/api`                    | ✅ API (Fastify): OTP، JWT + refresh چرخشی، سفارش، رزرو، چت (HTTP + WebSocket)، اعلان، اعتبار و تعلیق، امتیازدهی، پلن/اشتراک، پرداخت کارت‌به‌کارت و درگاه، اختلاف، مناطق، آمار بازار، نمایه‌ی کاربر و کارت عمومی، تنظیمات ادمین، لاگ ممیزی، ۱۶ مسیر مدیریتی، زنجیره‌ی پیامک با failover، قالب OTP و مسیر verify — ۲۲۶ تست                            |
| `infra/`                      | ✅ مهاجرت‌های تولیدی + seed + Docker Compose/Caddy و سه ایمیج (api/admin/web) — [docs/DB.md](docs/DB.md)                                                                                                                                                                                                                                             |
| `apps/admin`                  | ✅ پنل مدیریت React/Vite (RTL، ۱۰ صفحه، ۲۹ کلید تنظیمات، لاگ ممیزی) — ۲۰ تست، [docs/ADMIN.md](docs/ADMIN.md)                                                                                                                                                                                                                                         |
| `apps/web`                    | ✅ اپ مشتری React/Vite: ورود OTP، بازار با فیلترهای URL، ثبت سفارش، رزرو، صفحه‌ی معامله با شمارش معکوس و امتیازدهی، چت، سفارش‌های من، پروفایل/اعتبار با ویرایش نام نمایشی، اشتراک و اعلان‌ها، PWA نصب‌شدنی با پوسته‌ی آفلاین — ۹۰ تست، [docs/DESIGN.md](docs/DESIGN.md) · [docs/PWA.md](docs/PWA.md) · تأیید چشمی طراحی (E9-02) و نصب روی iPhone باز |
| آداپتور Postgres              | ⏳ مناطق روی PostGIS پیاده شد؛ بقیه‌ی مخزن‌ها هنوز درون‌حافظه‌ای (E2-02…)                                                                                                                                                                                                                                                                            |

## شروع سریع

```bash
corepack enable && corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm -r build
pnpm -r test

# API روی http://localhost:3000 (بدون Docker، با مخزن درون‌حافظه‌ای)
cp .env.example .env
pnpm dev:api

# پنل مدیریت روی http://localhost:5174 (پراکسی /v1 → 3000)
pnpm dev:admin

# اپ مشتری روی http://localhost:5173 (راهنمای سبک: /style-guide)
pnpm dev:web

# آزمودن PWA روی بیلد تولیدی (سرویس‌ورکر فقط اینجا ثبت می‌شود)
pnpm --filter @benzin/web build && pnpm --filter @benzin/web preview
pnpm --filter @benzin/web icons   # بازتولید آیکون‌های اپ

# بار سبک روی سقف‌های سوءاستفاده (اپ را روی پورت موقت بالا می‌آورد)
pnpm --filter @benzin/api load:smoke          # ۴۰ درخواست موازی
pnpm --filter @benzin/api load:smoke -- 200   # ۲۰۰ درخواست موازی
```

```bash
# کل استک (Postgres/PostGIS + Redis + API + وبه‌اپ + پنل + Caddy)
cd infra && docker compose up -d
# Caddy: http://localhost:8080 (وب‌اپ روی /، پنل روی /admin، API روی /v1)
```

### جریان ورود در محیط توسعه

`POST /v1/auth/otp/request` با `{"phone":"09121234567"}` — کد پنج‌رقمی در لاگ API چاپ می‌شود
(`[sms] → 0912…: کد ورود شما به بنزین: ۱۲۳۴۵`، ارقام لاتین). سپس
`POST /v1/auth/otp/verify` با همان کد، یک توکن Bearer برمی‌گرداند.

## معماری

```
apps/api        NestJS-style modular monolith on Fastify (domain → services → HTTP)
apps/web        React 18 + Vite + Tailwind، توکن و کامپوننت اختصاصی، PWA نصب‌شدنی (E9-15)؛ Capacitor در انتظار Android SDK
apps/admin      پنل مدیریت، SPA جدا با همان Design System
packages/shared enums, zod schemas, settings, state machines, Persian formatters
infra           migrations, docker compose, Caddy, Dockerfile
docs            brief, ADRs, assumptions, spike notes
```

قواعد ثابت: TypeScript سختگیر، بدون `any`، هر تغییر وضعیت از طریق ماشین حالت،
همه‌ی متن‌های UI از فایل‌های i18n فارسی، هیچ رمزی در گیت.

## مستندات

- [`docs/BRIEF.md`](docs/BRIEF.md) — نقشه‌ی مهندسی برگرفته از Master Brief
- [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) — فرض‌های ثبت‌شده (به‌جای حدس زدن)
- [`docs/ADR/`](docs/ADR) — تصمیم‌های معماری
- [`docs/PAYMENTS.md`](docs/PAYMENTS.md) — جریان پرداخت، اشتراک و reconciliation
- [`docs/SPIKE-001-providers.md`](docs/SPIKE-001-providers.md) — پیامک، درگاه، Push، نقشه
- [`docs/PWA.md`](docs/PWA.md) — نصب روی iOS، سیاست کش سرویس‌ورکر، آیکون‌ها و چک‌لیست تست دستگاه
- [`docs/TASKS.md`](docs/TASKS.md) — فهرست فازها؛ منبع حقیقت، تابلوی Notion است

## قراردادها

- شاخه‌ی هر تسک: `feat/E3-02-order-search`
- کامیت: Conventional Commits، انگلیسی (`feat(orders): add cursor pagination`)
- هر تسک: تست + Definition of Done، سپس PR و ادغام
