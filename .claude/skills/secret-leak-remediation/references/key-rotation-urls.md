# Key Rotation URLs — Quick Access

Consolidated links for rotating compromised API keys. Bookmark this.

## LLM Providers

| Provider | Rotation URL | Notes |
|----------|-------------|-------|
| **OpenRouter** | https://openrouter.ai/keys | Primary for Hermes. Delete old → Create new |
| **Anthropic** | https://console.anthropic.com/settings/keys | Direct API keys |
| **OpenAI** | https://platform.openai.com/api-keys | |
| **HuggingFace** | https://huggingface.co/settings/tokens | include Nous/HF Router tokens |
| **Nous Portal** | https://portal.nousresearch.com/manage-subscription | Subscription-managed keys |
| **Google AI Studio** | https://aistudio.google.com/app/apikey | Gemini API keys |
| **Mistral** | https://console.mistral.ai/api-keys/ | |
| **Cohere** | https://dashboard.cohere.com/api-keys | |
| **Together AI** | https://api.together.ai/settings/api-keys | |
| **Fireworks AI** | https://fireworks.ai/account/api-keys | |
| **Groq** | https://console.groq.com/keys | |
| **Perplexity** | https://www.perplexity.ai/settings/api | |

## Cloud & Infra

| Provider | Rotation URL | Notes |
|----------|-------------|-------|
| **GitHub (PAT)** | https://github.com/settings/tokens | Classic or Fine-grained (prefer fine-grained) |
| **GitLab** | https://gitlab.com/-/user_settings/personal_access_tokens | |
| **AWS** | https://console.aws.amazon.com/iam/home#/security_credentials | Access keys → Make inactive → Create new |
| **GCP** | https://console.cloud.google.com/apis/credentials | Service account keys |
| **Azure** | https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade | App registrations → Certificates & secrets |
| **Vercel** | https://vercel.com/account/tokens | |
| **Netlify** | https://app.netlify.com/user/applications#personal-access-tokens | |
| **Railway** | https://railway.app/account/tokens | |
| **Render** | https://dashboard.render.com/account/api-keys | |
| **Fly.io** | https://fly.io/user/personal_access_tokens | |
| **DigitalOcean** | https://cloud.digitalocean.com/account/api/tokens | |

## Databases & Storage

| Provider | Rotation URL | Notes |
|----------|-------------|-------|
| **Supabase** | https://supabase.com/dashboard/project/_/settings/api | anon + service_role keys |
| **PlanetScale** | https://app.planetscale.com/organization/_/settings/access-tokens | |
| **Neon** | https://console.neon.tech/app/settings/api-keys | |
| **Upstash** | https://console.upstash.com/account/api-tokens | Redis/Kafka |
| **Cloudflare** | https://dash.cloudflare.com/profile/api-tokens | R2, D1, KV tokens |
| **AWS S3** | IAM console → User → Security credentials | Access keys |

## Monitoring & Web

| Provider | Rotation URL | Notes |
|----------|-------------|-------|
| **Firecrawl** | https://firecrawl.dev/dashboard/api-keys | |
| **FAL** | https://fal.ai/dashboard/keys | Image/video generation |
| **Notion** | https://www.notion.so/my-integrations | Internal integrations |
| **Linear** | https://linear.app/settings/api | |
| **Slack** | https://api.slack.com/apps → OAuth & Permissions | Bot User OAuth Token |
| **Discord** | https://discord.com/developers/applications | Bot token |
| **Telegram** | @BotFather → /mybots → API Token | |
| **Sentry** | https://sentry.io/settings/account/api-keys/ | |
| **Datadog** | https://app.datadoghq.com/organization-settings/api-keys | |
| **Grafana Cloud** | https://grafana.com/orgs/_/api-keys | |

## Email & Communication

| Provider | Rotation URL | Notes |
|----------|-------------|-------|
| **SendGrid** | https://app.sendgrid.com/settings/api_keys | |
| **Mailgun** | https://app.mailgun.com/app/account/security/api_keys | |
| **Postmark** | https://account.postmarkapp.com/servers/_/credentials | |
| **Resend** | https://resend.com/api-keys | |
| **Twilio** | https://console.twilio.com/us1/develop/configure | Account SID + Auth Token |

## Quick Rotation Checklist

```
[ ] OpenRouter
[ ] Anthropic
[ ] HuggingFace / Nous
[ ] GitHub
[ ] Firecrawl
[ ] FAL
[ ] Notion
[ ] Telegram (if bot compromised)
[ ] Any project-specific keys in .env
```

## Pro Tip: Use a Password Manager

Store all API keys in 1Password / Bitwarden / KeePass with tags:
- `#api-key`
- `#provider:openrouter`
- `#project:hermes-vault`
- `#rotated:2026-06-09`

Then rotation = generate new in vault → update provider → update `.env` → deploy.
