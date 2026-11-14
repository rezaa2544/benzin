# بودجه‌ی کارایی و برنامه‌های اجرا (Query Plans)

هدف: هیچ صفحه‌ای از API بدون یک عدد مشخص «سریع» نامیده نشود. این فایل بودجه‌ها را ثابت می‌کند و
روش تأیید روی Postgres واقعی را می‌نویسد.

## بودجه‌های فعلی

| مسیر                              | حجم                    | بودجه                                                          |
| --------------------------------- | ---------------------- | -------------------------------------------------------------- |
| `GET /v1/orders` (جستجو، ۲۰ آیتم) | ۱۰٬۰۰۰ سفارش در یک شهر | < ۵۰۰ms روی مخزن درون‌حافظه‌ای؛ < ۱۵۰ms روی Postgres با ایندکس |
| `GET /v1/zones/locate`            | ۱ شهر                  | < ۲۰ms                                                         |
| `GET /v1/stats/market`            | ۵٬۰۰۰ سفارش نمونه      | < ۳۰۰ms                                                        |

تست‌های مربوطه: `apps/api/test/market.test.ts` («answers a page of 20 from 10,000 orders quickly»).

## ایندکس جستجو (E3-01)

`orders_open_search_idx`:

```sql
CREATE INDEX "orders_open_search_idx"
  ON "orders" (zone_id, side, tier, rate_toman, created_at)
  WHERE status = 'OPEN';
```

ترتیب ستون‌ها عمداً با کوئری API یکی است: سه شرط برابری (`zone_id`, `side`, `tier`)، سپس ستون
مرتب‌سازی/محدوده‌ی قیمت و در آخر `created_at` برای ترتیب «جدیدترین». شرط جزئی `status = 'OPEN'`
حجم ایندکس را تقریباً به سفارش‌های زنده محدود می‌کند. `expires_at > now()` عمداً در ایندکس نیست:
`now()` تابع immutable نیست و Postgres اجازه‌ی چنین predicate ای نمی‌دهد؛ همین فیلتر بعد از
اسکن ایندکس ارزان است و ایندکس `orders_expiry_idx` برای جاروی انقضا جداست.

## تأیید روی Postgres واقعی

```bash
psql "$DATABASE_URL" <<'SQL'
SET enable_seqscan = off;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM orders
WHERE zone_id = '2b1f8f6e-9f1a-4c1b-9d0e-7a1c2b3d4e5f'
  AND side = 'SELL' AND tier = 'T3000' AND status = 'OPEN'
  AND expires_at > now()
ORDER BY rate_toman, created_at
LIMIT 20;
SQL
```

انتظار:

```
Limit
  ->  Index Scan using orders_open_search_idx on orders
        Index Cond: ((zone_id = '...') AND (side = 'SELL') AND (tier = 'T3000'))
```

اگر `Seq Scan` دیدید، اول `ANALYZE orders;` بزنید؛ در جدول‌های کوچک planner عمداً seq scan را
ترجیح می‌دهد. تأیید نهایی این تسک روی محیطی با Postgres انجام می‌شود (docs/DB.md).

جستجوی جغرافیایی (`radiusKm`) از `orders_location_gist` (GiST روی `location`) استفاده می‌کند و
مرتب‌سازی فاصله با `ST_Distance` انجام می‌شود؛ این مسیر در E7 به‌همراه بار واقعی اندازه‌گیری
می‌شود.

## بار سبک روی سقف‌ها (E1-07)

`pnpm --filter @benzin/api load:smoke -- <n>` اپ واقعی Fastify را روی یک پورت موقت بالا می‌آورد و
هر سقف را با `<n>` درخواست موازی از راه HTTP می‌سنجد (نه فراخوانی مستقیم سرویس). خروجی با
۲۰۰ درخواست موازی روی مخزن درون‌حافظه‌ای:

| سناریو              | سقف                    | نتیجه با ۲۰۰ درخواست موازی |
| ------------------- | ---------------------- | -------------------------- |
| ارسال دوباره‌ی کد   | ۱ پیامک در هر ۶۰ ثانیه | `202×1 429×199` (sms=1)    |
| تلاش روی کد         | ۵ تلاش                 | `401×5 429×195`            |
| سفارش باز هر کاربر  | ۲                      | `201×2 429×198`            |
| رزرو یک سفارش       | ۱ (۵۰ خریدار)          | `201×1 409×49`             |
| replay توکن refresh | ۱ چرخش (۲۵ فراخوان)    | `200×1 401×24`             |

سقف‌ها «check-then-write» هستند، پس بدون هم‌زمان‌سازی دو درخواست هم‌زمان هر دو جای خالی را
می‌بینند. `KeyedLock` بخش بحرانی را سریال می‌کند (کلید: کاربر مالک سفارش، خریدار رزرو، شماره
تلفن برای OTP، خانواده‌ی توکن برای refresh). اثبات در تست‌ها: `apps/api/test/abuse.test.ts`
(۶ سناریوی موازی) و `keyed-lock.test.ts`.

محدوده: یک پروسه. برای چند نمونه، قید یکتا در Postgres لازم است (A34)؛ اندازه‌گیری نهایی روی
Postgres واقعی در M1 انجام می‌شود.
