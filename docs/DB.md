# پایگاه‌داده: مهاجرت، seed و بازگشت

منبع حقیقت اسکیما `apps/api/src/infra/db/schema.ts` است (Drizzle). SQL تولیدشده در
`infra/migrations` **کامیت می‌شود** تا هر تغییر اسکیما در PR قابل بازبینی باشد.

## دستورها

```bash
pnpm --filter @benzin/api db:migrate   # اعمال مهاجرت‌های باقی‌مانده
pnpm --filter @benzin/api db:seed      # داده اولیه (idempotent)
pnpm --filter @benzin/api db:status    # فایل‌ها و تعداد مهاجرت اعمال‌شده
pnpm --filter @benzin/api db:reset     # DROP SCHEMA + migrate + seed (فقط غیر production)
```

نیازمند `DATABASE_URL`. با `docker compose -f infra/docker-compose.yml up -d` یک
Postgres 16 + PostGIS آماده است و فایل‌های `infra/migrations` در بار اول خودکار اجرا می‌شوند.

## تولید مهاجرت جدید

```bash
# بعد از تغییر schema.ts
pnpm --filter @benzin/api db:generate --name <change_name>
```

اگر مهاجرت به دستور خام نیاز دارد (مثل `CREATE EXTENSION` که Drizzle نمی‌تواند بیان کند)،
همان خط را با کامنت توضیحی به فایل تولیدشده اضافه کن؛ `prettier` روی `infra/migrations` خاموش است
تا فایل‌ها byte-stable بمانند.

## سیاست بازگشت (down)

مهاجرت‌ها forward-only هستند. «down» در این پروژه یعنی `db:reset` روی محیط توسعه، و
**بازیابی از بکاپ** روی production (تسک E10-02). هیچ مهاجرت خودکاری داده را حذف نمی‌کند.

## داده‌ی اولیه (E1-02)

| موجودیت | مقدار                                                            |
| ------- | ---------------------------------------------------------------- |
| شهر     | بانه (polygon تقریبی، ASSUMPTION A8)                             |
| پلن‌ها  | یک‌ماهه ۴۹٬۰۰۰ تومان، سه‌ماهه ۱۲۹٬۰۰۰ تومان                      |
| تنظیمات | همه‌ی کلیدهای `packages/shared/src/settings.ts` با مقدار پیش‌فرض |

`applySeed()` هم در CLI (Postgres) و هم در بوت توسعه (مخزن درون‌حافظه‌ای) استفاده می‌شود، پس
محیط توسعه و تست از همان ابتدا «بانه» را پوشش می‌دهد.

## تست‌های بدون پایگاه‌داده

`apps/api/test/db-schema.test.ts` SQL تولیدشده و داده‌ی seed را بدون Postgres بررسی می‌کند:
وجود هر جدول، ایندکس یکتای جزئی رزرو، ایندکس‌های GiST، ایندکس‌های چت/اعلان، ترتیب extension
قبل از ستون geography، و سازگاری seed با قیدهای دامنه.

## مهاجرت‌های موجود

| فایل                            | تغییر                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `0000_init.sql`                 | اسکیمای کامل + ایندکس‌های حساس                                                                      |
| `0001_refresh_token_family.sql` | ستون خانواده‌ی توکن برای تشخیص استفاده‌ی مجدد (ADR-0002)                                            |
| `0002_chat_kinds.sql`           | `messages.kind` (TEXT/CONTACT/SYSTEM، با CHECK) و `notifications.kind`؛ سقف متن پیام ۵۰۰ → ۲۰۰۰     |
| `0003_trust_and_ratings.sql`    | `users.suspended_until` و جدول `trade_ratings` با CHECK ستاره ۱…۵ و ایندکس یکتا (رزرو، امتیازدهنده) |
