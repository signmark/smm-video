---
name: market-research
description: "Competitive analysis, market sizing, and GTM research for SaaS/AI products. Covers competitor discovery, feature/pricing/channel comparison, retention mechanics audit, and actionable GTM insights."
platforms: [linux, macos, windows]
tags: [research, saas, competitive-analysis, gtm, pricing, retention]
---

# Market Research Skill

## When to Use
Use when the user asks for:
- Competitive landscape analysis for a product idea or existing product
- Market sizing and TAM/SAM/SOM estimation
- Pricing strategy research across competitors
- Channel/acquisition strategy analysis
- Retention/engagement mechanics audit
- GTM (Go-to-Market) insights and actionable recommendations
- "Analyze competitors for X" or "Research market for Y"

## Workflow

### 1. Clarify Scope (if not provided)
Ask for:
- **Product category** (AI coach, fitness app, dev tool, etc.)
- **Target geo** (RU, global, specific countries)
- **Target segment** (B2C, B2B, prosumer, enterprise)
- **Research depth** (quick scan 5-10 competitors vs deep dive 20+)
- **Output format** (markdown report, comparison table, CSV, presentation)

### 2. Competitor Discovery
```bash
# Search patterns for discovery
web_search("AI coach app Russia competitive landscape 2026")
web_search("best AI fitness coach app pricing subscription")
web_search("AI career mentor app Telegram bot Russia")
web_search("site:play.google.com AI coach подписка рубль")
web_search("site:apps.apple.com AI коуч приложение")
```

**Sources to check:**
- App Store / Google Play (top charts, category rankings)
- Product Hunt, G2, Capterra, AlternativeTo
- Telegram channels / Reddit / VC.ru / T-J / Habr discussions
- Competitor websites → pricing pages, blogs, help centers
- Sensor Tower / data.ai / AppMagic (if accessible) for download/revenue estimates

### 3. Data Collection Template (per competitor)

| Field | Source |
|-------|--------|
| Product name, category, positioning | Website, app store description |
| **Pricing** (monthly, annual, lifetime, freemium limits) | Pricing page, in-app purchase screen |
| **Onboarding flow** (steps, time-to-value, personalization depth) | Sign up + test, or video reviews |
| **Core features & differentiators** | Website, docs, reviews |
| **Retention mechanics** (streaks, daily rituals, progress viz, social, limited sessions) | App usage, reviews, blog posts |
| **Acquisition channels** (ASO, influencers, content SEO, paid, partnerships, virality) | SimilarWeb, backlink check, ad libraries, founder interviews |
| **Tech stack / platform** (iOS, Android, Web, TG bot, Alexa, desktop) | App stores, website footer |
| **Team / funding / traction** | Crunchbase, LinkedIn, interviews, "About" page |
| **User sentiment** (rating, review themes, NPS proxies) | App store reviews, Reddit, Telegram chats |
| **Localization** (RU language, RU payments, RU support) | App stores, checkout flow test |

### 4. Synthesis & Output

**Deliverables (pick based on user need):**

1. **Comparison Table** (markdown) — 10-20 competitors × 15-20 dimensions
2. **Pricing Landscape** — tier breakdown, RU payment support, anchor strategies
3. **Channel Map** — where each competitor acquires users, gaps/opportunities
4. **Retention Mechanics Audit** — what works, what's missing, innovation opportunities
5. **Onboarding Benchmark** — time-to-value, personalization depth, friction points
6. **3-5 GTM Insights** — actionable, specific to user's context (budget, team, timeline)
6. **Launch Checklist** — phased (MVP → Launch → Scale) with success criteria

### 5. Save & Sync
```bash
# Always save to vault + git
write_file("~/hermes-vault/market-research-<topic>-<date>.md", report)
git add ... && git commit -m "research: <topic> competitive analysis" && git push
```

## Tools & Patterns

| Task | Tool |
|------|------|
| Web search (broad) | `web_search` with geo/category operators |
| Deep extract (pricing pages, docs) | `web_extract` (max 5 URLs/call) |
| App store data | `web_extract` on play.google.com / apps.apple.com URLs |
| Review sentiment | `web_search` + `web_extract` on review aggregators |
| Traffic estimates | SimilarWeb free tier, Sensor Tower blog posts |
| Russian market specifics | Yandex search, VC.ru, T-J, Telegram channel search |

## Russian Market Specifics (Critical)

| Factor | Implication |
|--------|-------------|
| **Payments** | Stripe/Paddle don't work → need RU acquiring (ЮKassa, CloudPayments, Telegram Stars, App Store/GP billing) |
| **Distribution** | Telegram-native (bots, channels) often beats App Store for CAC |
| **Trust signals** | Сколково, эксперты, научная база, отзывы «живой характер» |
| **Localization** | RU language = table stakes; RU support = differentiator |
| **Price sensitivity** | ₽300-500/мес mass market; ₽1000-2000/мес pro; anchor vs ~$15-20 global |

### 🎯 Key RU Pattern: Telegram-First for AI Products (Discovered 17.06.2026)

**Insight from AI Coach Ru-market analysis:** No major AI coach product has a native Telegram bot as primary interface — they all use App Store / Web. RU users live in Telegram: notifications open 3-4× more than App Store push. 

**MVP Pattern:** TG bot with morning/evening rituals + Telegram Stars payments + viral distribution via TG channels (ТЖ, VC, niche communities) → CAC ≈ $0.

**Example Competitors Using This:** Dola AI, Колесо баланса, Чекеры — 50K-500K+ users, native TG bots, zero paid acquisition.

**When building AI products for RU:** Start with TG bot MVP, not App Store. Add Web/App as Pro tier later.

## Common Pitfalls

| Pitfall | Prevention |
|---------|------------|
| Only checking global leaders (miss RU-local gems) | Always search in Russian + "Россия / ру / рубль" |
| Ignoring Telegram bots as competitors | Search "TG бот AI коуч / трекер привычек / ментор" |
| Missing freemium → paid conversion mechanics | Test signup flow yourself; extract paywall screens |
| Overweighting features, underweighting retention | Track DAU/MAU proxies (review velocity, update frequency) |
| Not verifying RU payment flow | Attempt test purchase or find checkout screenshots |
| Single-source data (only website) | Triangulate: site + app store + reviews + third-party |

## Quality Gates

Before delivering:
- [ ] At least 8-10 competitors with pricing filled
- [ ] RU payment verified for each (or explicitly "not supported")
- [ ] Retention mechanics extracted (not just features)
- [ ] Channel mix has evidence (not guesses)
- [ ] 3+ actionable GTM insights tied to user's constraints
- [ ] Report saved to vault + git pushed

## Competitive Analysis Templates (absorbed from `market-research-competitive-analysis`)

### Comparison Table

| # | Product | Category | Price (RU/global) | Onboarding | Key USP | Retention Mechanics | Acquisition Channels | Rating |
|---|---------|----------|-------------------|------------|---------|---------------------|---------------------|--------|

**Required columns:** product, category, price, onboarding_time, usp, retention, channels, rating

### Pricing Landscape

| Model | Examples | RU Price (approx.) | Key Constraint |
|-------|----------|-------------------|----------------|
| Monthly sub | Competitor A, B | 1300-1800 RUB/mo | Auto-renew |
| Annual sub (40-60% off) | Competitor C, D | 6000-12000 RUB/yr | Best LTV |
| One-time purchase | Competitor E | ~300 RUB | Low ARPU |
| Freemium → Pro | Competitor F, G | Varies | Hard in RU |
| White-label / B2B | Competitor H | 9000-18000 RUB/mo | Long sales cycle |

### Retention Mechanics Checklist (Score 1-5)

| Mechanic | Works For | Why |
|----------|-----------|-----|
| Daily ritual (morning/evening push) | | Habit anchor |
| Streak / consecutive days | | Loss aversion |
| Progress graphs | | Visible result = dopamine |
| Personal context (memory) | | "It knows me" → trust |
| Limited sessions (scarcity) | | Quality > quantity |
| Challenges / social | | Social pressure |
| Expert content (blog/academy) | | Value outside chat |

### GTM Insight Template (3 Required)

Each insight must be:
1. **Actionable** — "Do X, not Y"
2. **Specific** — references competitor mechanic
3. **Leveraged** — applies to user's constraints (budget, team, timeline)

### Launch Checklist

| Week | Focus | Success Criteria |
|------|-------|------------------|
| 1-2 | MVP core loop | D1 Retention >= 40% |
| 3 | Lead Magnet + Landing | CR >= 15% |
| 4 | Payments (local) | 5 successful test transactions |
| 5-6 | Retention features | D30 Free >= 20%, Pro >= 60% |
| 7-8 | B2B Pilot | 1 paid pilot at target price |

## References
- `references/ru-market-payments.md` — RU payment providers, integration patterns
- `references/competitor-discovery-queries.md` — proven search queries by category
- `references/ai-coach-ru-analysis-2026-06-17.md` — AI Coach Ru-market competitive analysis (case study)
- `templates/competitor-profile.md` — per-competitor data collection template
- `templates/comparison-table.md` — markdown table with standard columns