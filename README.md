# Arzish

Portfolio forecast analyzer for Pakistani investors: PSX shares, mutual funds, National Savings,
gold, property, foreign assets and crypto, valued with daily market data, with Monte Carlo
forecasts, stress tests, an optimizer, tax and zakat, alerts and an AI analyst built on Claude.

One codebase builds two editions:

- **Web edition** (hosted): static site on Vercel, Supabase for the database, sign-in and server
  functions, Resend for email, Safepay for card subscriptions, the Claude API for the AI analyst.
- **Artifact edition**: a single HTML file that runs inside Claude (`dist/arzish.html`).

## Layout

| Path | What it is |
|---|---|
| `src/engine/` | Valuation, simulation, risk, optimizer, tax: pure TypeScript, shared by the app and the edge functions |
| `src/ui/`, `src/state/` | The analyzer app (React) |
| `src/web/` | Web edition only: Supabase runtime, sign-in, account, plans and paywall, notifications, back office (`/admin`) |
| `web/` | Landing, legal and 404 pages, and the `app.html` shell |
| `supabase/functions/` | Edge functions: `api` (sign-in codes, AI proxy, billing, account, admin actions) and `jobs` (market load, notifications, digest, clean-up) |
| `supabase/migrations/` | Database schema, row-level security, settings, cron schedules (no secret values) |
| `test/` | Engine tests and the browser QA suite (`test/web-qa`, Playwright against a mocked Supabase) |

## Commands

```bash
npm ci
npm run typecheck
npm run build:web        # web-dist/ for Vercel
npm run build            # dist/arzish.html, the artifact edition
npm run build:functions  # build/functions/{api,jobs}, the shape the Supabase deploy takes
node test/run-engine-tests.mjs
python3 test/web-qa/qa.py [screenshot-dir]
```

## Hosting

- **Vercel**: `vercel.json` builds with `npm run build:web` and serves `web-dist/`, with clean URLs,
  the `/app`, `/signin` and `/admin` rewrites, long caching for hashed assets and a strict CSP.
- **Supabase** project `qgmltrboyhnwnugyrcek` (Mumbai). Functions are deployed with JWT
  verification off; each route checks its own caller.
- **Secrets** (never in this repo): function secrets `ANTHROPIC_API_KEY`, `SAFEPAY_SECRET_KEY`,
  `SAFEPAY_WEBHOOK_SECRET`; Vault secrets `cron_secret`, `project_url`, `resend_api_key`.
- **Settings** live in the `app_settings` table and are edited in the back office (Settings).

Market data comes from the scrapers in the `arzish-data` repository; the `jobs` function loads it
every morning and after the PSX close.
