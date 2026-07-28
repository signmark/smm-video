# RU Market Payment Providers & Integration Patterns

> Collected during AI Coach Ru-market competitive analysis (June 2026)

## Payment Providers Supporting RU Cards

| Provider | Type | Integration | Fees | Notes |
|----------|------|-------------|------|-------|
| **ЮKassa (ЮMoney)** | Acquiring | Widget, API, SDK | ~2.5-3.5% | Most popular, supports recurring, 54-FZ compliant |
| **CloudPayments** | Acquiring | Widget, API, SDK | ~2.5-3.5% | Good recurring, sub-merchant model |
| **Тинькофф Касса** | Acquiring | Widget, API | ~2.5-3.5% | Strong for B2B, easy recurring |
| **Сбербанк Эквайринг** | Acquiring | Widget, API | ~2-3% | Enterprise, slower onboarding |
| **Telegram Stars** | Internal currency | Bot API | 0% (Apple/Google take 30% on purchase) | Native TG, no card data, instant refunds |
| **App Store / Google Play Billing** | Platform | In-App Purchase | 15-30% | Required for iOS/Android apps, handles RU cards |

## Competitor Payment Patterns Observed

| Product | Payment Method | RU Cards | Recurring | Notes |
|---------|---------------|----------|-----------|-------|
| **F/AI** | Custom pay.fitgpt.pro (likely ЮKassa/CloudPayments) | ✅ | ✅ Yearly | Separate payment portal, deep links from app |
| **Insona** | App Store / Google Play | ✅ | ✅ Monthly | Platform billing, 30% fee |
| **Freudly** | App Store / Google Play | ✅ | ✅ Monthly | Platform billing, free trial session |
| **Zing Coach** | App Store / Google Play | ✅ | ✅ Monthly/Yearly | Global, RU cards work via platform |
| **Rocky AI** | App Store / Google Play + Web (Stripe) | ❌ Web | ✅ | Web Stripe doesn't accept RU cards; mobile via platform |
| **CoachMe AI** | App Store only (iOS) | ✅ | ❌ One-time €2.99 | No Android, no web |
| **Reflectly** | App Store / Google Play | ✅ | ✅ Freemium | Platform billing |
| **Mentor.AI** | In-app purchases (Google Play) | ✅ | ❌ | No RU language, stability issues |
| **TG Bots (Dola, etc.)** | Telegram Stars | ✅ | ✅ | **Zero fee**, native, viral |

## Integration Recommendations by Product Type

| Product Type | Primary | Fallback | Rationale |
|--------------|---------|----------|-----------|
| **Telegram Bot MVP** | Telegram Stars | Web ЮKassa link | Stars = 0% fee, native UX, instant; web for yearly discounts |
| **Mobile App (iOS/Android)** | App Store / GP Billing | — | Mandatory for app store compliance |
| **Web App / PWA** | ЮKassa / CloudPayments widget | Telegram Stars deep link | Full control, recurring, 54-FZ |
| **Hybrid (TG + Web)** | TG Stars (monthly) + ЮKassa (yearly) | — | Best of both: viral monthly, committed yearly |

## Technical Patterns

### Telegram Stars Flow
```python
# 1. Create invoice in bot
await bot.send_invoice(
    chat_id=user_id,
    title="Pro Monthly",
    description="Unlimited AI coach chat + progress dashboard",
    payload="pro_monthly",
    provider_token="",  # Empty for Stars
    currency="XTR",
    prices=[LabeledPrice(label="Monthly", amount=490)]  # 490 Stars = ~₽490
)

# 2. Handle pre_checkout_query
@dp.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery):
    await query.answer(ok=True)

# 3. Handle successful_payment
@dp.message(F.successful_payment)
async def successful_payment(msg: Message):
    # Activate subscription in DB
    await activate_subscription(msg.from_user.id, msg.successful_payment.invoice_payload)
```

### ЮKassa Recurring (Web)
```python
# 1. Create payment with save_payment_method=true
payment = yookassa.Payment.create({
    "amount": {"value": "490.00", "currency": "RUB"},
    "capture": True,
    "confirmation": {"type": "embedded"},
    "save_payment_method": True,
    "description": "Pro Monthly - AI Coach"
})

# 2. On success, store payment_method_id for recurring
# 3. Create recurring via saved method (auto or manual)
```

## Legal/Compliance (54-FZ)
- **Оферта** required on payment page
- **Чек** must be sent via OFD (ЮKassa/CloudPayments handle automatically)
- **Персональные данные** — consent checkbox required
- **Автопродление** — must be clearly disclosed, easy cancel

## Price Anchoring Strategy (RU Market)

| Tier | Monthly | Yearly (discount) | Lifetime | Psychology |
|------|---------|-------------------|----------|------------|
| **Mass** | ₽490 | ₽4,900 (17% off) | — | "Price of coffee/week" |
| **Pro** | ₽990 | ₽9,900 (17% off) | ₽29,900 | "Less than 1 session with live coach" |
| **Team** | ₽9,900/5 seats | ₽99,000/year | — | B2B budget line item |

**Key insight**: F/AI uses "60% off yearly" as primary CTA. Insona/Freudly ~$15-19/мес = ₽1,300-1,800. **Anchor at ₽4,900/year = ₽408/мес = 3-4× cheaper than competitors**.

## Testing Checklist
- [ ] RU card (Сбер, Тинькофф, Альфа) → success
- [ ] Recurring charge → success (2nd month)
- [ ] Cancel subscription → immediate stop, no further charges
- [ ] Refund → processed within 5-10 business days
- [ ] 54-FZ receipt → delivered to email/phone
- [ ] Promo code → applies correctly
- [ ] Grace period on failed payment → 3-7 days retry