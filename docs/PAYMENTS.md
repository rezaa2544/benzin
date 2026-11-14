# پرداخت، اشتراک و تسویه

این سند جریان پول در بنزین را توصیف می‌کند (اپیک E7). همه‌ی مبالغ **تومان** و صحیح‌اند؛
تبدیل به ریال فقط داخل `ZarinpalGatewayProvider` انجام می‌شود.

## جریان خرید اشتراک

```
POST /v1/subscriptions {planCode, method}
        │
        ├─ method=CARD_TO_CARD →  مبلغ یکتا + کارت مقصد  →  تأیید ادمین یا ingestion (E7-05، بلاک)
        └─ method=GATEWAY      →  redirectUrl درگاه     →  POST /v1/payments/:id/gateway/callback
                                                            │
                                                     verify نزد ارائه‌دهنده
                                                            │
                                         PAID + subscription ACTIVE + اعلان PAYMENT_APPROVED
```

- خرید همیشه یک `subscription` با وضعیت `PENDING` و یک `payment` با وضعیت `PENDING` می‌سازد؛
  هیچ اشتراکی بدون اثبات پرداخت فعال نمی‌شود.
- مبلغ یکتای کارت‌به‌کارت (پایه + ۱ تا `payment.unique_suffix_max`) با ایندکس یکتای جزئی
  `payments_unique_amount_idx` محافظت می‌شود؛ تصادم باعث تلاش دوباره با پسوند تازه است.
- مهلت: `payment.card_to_card_ttl_minutes` (پیش‌فرض ۱۲۰) و `payment.gateway_ttl_minutes` (پیش‌فرض ۳۰).

## ارائه‌دهنده‌ها

| ارائه‌دهنده                   | کلاس                      | وضعیت                                       |
| ----------------------------- | ------------------------- | ------------------------------------------- |
| درگاه بانکی (زرین‌پال)        | `ZarinpalGatewayProvider` | ✅ درخواست/تأیید واقعی، تست با fetch تزریقی |
| سندباکس درگاه                 | `SandboxGatewayProvider`  | ✅ پیش‌فرض توسعه و CI (بدون شبکه)           |
| کارت‌به‌کارت                  | `CardToCardProvider`      | ✅ کارت مقصد از پنل؛ تأیید دستی             |
| Ingestion خودکار کارت‌به‌کارت | —                         | ⛔️ بلاک (E7-05): نیاز به فید پیامک بانکی    |

`PAYMENT_GATEWAY=sandbox|zarinpal` انتخاب می‌کند؛ برای زرین‌پال `ZARINPAL_MERCHANT_ID` الزامی است.

## Reconciliation (E7-06)

`POST /v1/admin/reconciliation` و همچنین `scheduler.tick()` این سه کار idempotent را انجام می‌دهند:

1. `payment` های `PENDING` که `expires_at` گذشته‌اند → `EXPIRED`.
2. `payment` های `PAID` که اشتراکشان هنوز `PENDING` است (کرش بین دو مرحله) → فعال‌سازی اشتراک.
3. اشتراک‌های `ACTIVE` که `ends_at` گذشته‌اند → `EXPIRED` + اعلان `SUBSCRIPTION_EXPIRED`.

## پنل ادمین (E7-07)

`GET /v1/admin/payments?status=`, `POST /v1/admin/payments/:id/{confirm,reject}`,
`GET|POST /v1/admin/payment-cards`, `POST /v1/admin/payment-cards/:id/deactivate`.
شماره‌ی کارت هرگز کامل برنمی‌گردد: همیشه `•••• •••• •••• ۱۲۳۴`.
