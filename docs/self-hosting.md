# Self-hosting

Two ways to run Sift yourself: as a plain single-user server on your own machine (the normal local edition, just long-running), or as your own deployment of the multi-tenant hosted edition.

## Plain local server

```bash
git clone https://github.com/mike-does-oss/sift && cd sift
npm install
npm run build
npm start
```

Requires Node 20+. SQLite auto-creates at `./data/sift.db`; `SIFT_DATA_DIR` points the database and uploaded files at a different directory, and `SIFT_MIGRATIONS_DIR` overrides where migration files are read from.

**Localhost only, by default.** There is no auth on the local edition, and `npm start` (like `npm run dev`) binds to `127.0.0.1` — reachable from that machine alone. If you expose it anyway (`next start -H 0.0.0.0`, a reverse proxy, etc.), anyone who can reach the address can read your extraction history, spend your API keys, and edit your settings. Put real authentication in front of it, or don't expose it.

## Deploying your own hosted instance

The hosted edition is what runs the multi-tenant SaaS profile: Postgres instead of SQLite, real sign-in, Vercel Blob storage, Stripe billing, and cron-driven workers. It's enabled by a single switch: `SIFT_PROFILE=hosted`.

The reference deployment shape is Vercel + Neon:

1. **Database** — a [Neon](https://neon.tech) Postgres project. Push the schema with `npm run db:push:pg` (reads `DATABASE_URL`).
2. **Auth** — Neon Auth (Better Auth SDK); set its base URL and cookie secret.
3. **Hosting** — a Vercel project with a [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) store for uploaded documents.
4. **Stripe** — create the products and prices for the paid plans:
   ```bash
   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/setup-stripe.ts
   ```
   It prints the three `STRIPE_PRICE_*` env lines to copy into your environment. Not idempotent — run it once per Stripe account. Point a Stripe webhook at `/api/stripe/webhook`; the webhook is the only thing that ever changes a user's plan.
5. **Crons** — `vercel.json` declares two hourly crons: `/api/jobs/process` (the extraction worker's crash-recovery sweep — normal work never waits for it, since extractions run inline and batch/schedule/email-arrival enqueues kick the worker directly, which then self-chains) and `/api/schedules/run` (the schedule ticker; schedules have hourly granularity, so hourly is exact). Both require an `Authorization: Bearer <CRON_SECRET>` header. Don't be tempted to run them every minute: on a serverless Postgres (Neon), a per-minute ping keeps the database compute awake 24/7 and burns your entire compute quota on idle polling.

### Environment variables

| Variable | Purpose |
|---|---|
| `SIFT_PROFILE` | `hosted` enables the multi-tenant profile; unset/anything else is the local profile |
| `DATABASE_URL` | Neon Postgres connection string |
| `NEON_AUTH_BASE_URL` | Neon Auth (Better Auth) base URL |
| `NEON_AUTH_COOKIE_SECRET` | Neon Auth session-cookie secret |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for document storage |
| `ANTHROPIC_API_KEY` | Platform Claude key that metered extractions run on |
| `ENCRYPTION_SECRET` | 64 hex chars (32 bytes); encrypts stored BYO Anthropic keys at rest (AES-256-GCM) |
| `CRON_SECRET` | Bearer token required by `/api/jobs/process` and `/api/schedules/run` |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe/webhook` |
| `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS` | Price IDs printed by `scripts/setup-stripe.ts` |
| `RESEND_API_KEY` | Resend API key — fetches inbound email content/attachments and sends digest emails |
| `RESEND_WEBHOOK_SECRET` | Signing secret (`whsec_…`) for the `email.received` webhook at `/api/inbox/email` |
| `RESEND_INBOUND_DOMAIN` | Domain of schedule email-in addresses (`<token>@<this domain>`), e.g. `abc123.resend.app` |

Local-profile variables (`SIFT_DATA_DIR`, `SIFT_MIGRATIONS_DIR`) don't apply on hosted.

### License note

Sift is AGPL-3.0-or-later: you're free to run it as a service, but if you run a **modified** Sift as a network service you must offer its source to your users.
