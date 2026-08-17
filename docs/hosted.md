# Hosted service

The hosted edition is Sift run as a multi-tenant service: sign in, upload, extract — no install, no Ollama. Extraction runs on Claude, metered by plan. If you'd rather run this deployment yourself, see [Self-hosting](self-hosting.md).

## Sign-up

Create an account with an email and password on the sign-up page. Everything under the dashboard requires being signed in, and every document, template, batch, schedule, and dataset is scoped to your account. New accounts start on the Free plan.

## Plans and pricing

Prices are in USD, per month. An "extraction" is one document run through one template — each document in a batch or scheduled run counts as one.

| | Free | Starter | Pro | Business |
|---|---|---|---|---|
| Price | $0 | $19 | $49 | $149 |
| Extractions / month | 10 | 200 | 1,000 | 5,000 |
| Claude model | `claude-haiku-4-5` | `claude-haiku-4-5` | `claude-sonnet-5` | `claude-sonnet-5` |
| Bring your own API key | — | yes | yes | yes |
| Batches | — | — | up to 25 files | up to 100 files |
| Schedules | — | — | — | yes |

## Usage metering

- The meter counts extractions started in the current **UTC calendar month**; it resets at the start of each month.
- **Failed extractions count.** A run that errors still consumed a model call. (Automatic retries of a queued job don't multiply the count — a document is one extraction no matter how many attempts it takes.)
- **BYO-key extractions are exempt.** While your own Anthropic key is active, runs bill to your key, not your quota.
- Quota is enforced up front: a single extraction needs 1 remaining, a batch needs one per document to be created at all, and a scheduled run only queues as many inbox documents as your remaining quota covers (the rest wait, unprocessed, for next month or an upgrade).

When you hit the limit you get a clear quota error — upgrade, add your own key, or wait for the month to roll over. Your current usage and plan are always visible in **Settings**.

## Billing

- **Upgrading**: pick a plan in Settings — you're sent to a Stripe Checkout page. Your plan activates as soon as payment confirms.
- **Managing**: once subscribed, plan changes, payment methods, invoices, and cancellation all go through the Stripe **Billing Portal** (Settings → billing). Plan changes are prorated by Stripe.
- **Cancelling / downgrading**: when a subscription ends you revert to Free. Features above your new plan stop working but nothing is deleted — existing schedules pause (and resume if you upgrade again), and your documents and history stay.

## Bring your own Anthropic key

On any paid plan you can store your own Anthropic API key in **Settings**:

- The key must be a valid Anthropic key (`sk-ant-…`); it's validated live against the Anthropic API before being accepted.
- While stored, **all** your extractions run on `claude-opus-4-8` — the strongest model tier, above every plan's default — and are quota-exempt.
- At rest the key is encrypted (AES-256-GCM); the UI only ever shows a masked form (`…last4`).
- Remove the key any time to return to your plan's model on the platform key. Note that queued work created while the key was active is billed to your key — if the key is removed before those jobs run, they fail rather than silently falling back to your quota.
