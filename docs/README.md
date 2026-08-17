# Sift documentation

Sift turns documents into structured data. Define the fields you want, run an extraction against a local or cloud model, review and edit the results, and export them.

## Which edition am I using?

Sift runs in two editions:

- **Local / desktop** — you run Sift yourself: `npm run dev` from a clone, or the desktop app. Single user, no sign-in, data in a local SQLite database, extraction via Ollama by default or your own cloud API keys. Unmetered — there are no plans or quotas.
- **Hosted** — a multi-tenant deployment (`SIFT_PROFILE=hosted`) with sign-in, metered plans, and Claude as the only extraction engine. If you signed up with an email and password and see a plan meter in Settings, you're on hosted.

Pages below say when a feature belongs to one edition only. Everything else applies to both.

## Pages

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install Sift locally and run your first extraction. |
| [Desktop app](desktop.md) | The macOS desktop app: install, where data lives, Ollama onboarding. |
| [Providers and models](providers.md) | Ollama, Anthropic, OpenAI, Gemini, OpenAI-compatible endpoints, and the hosted Claude tiers. |
| [Extraction](extraction.md) | Fields, types, grounded mode, prompt scaffolding, examples, supported formats and size caps. |
| [Templates, batches, and schedules](automation.md) | Reusable templates, batch runs, recurring schedules, output folders. |
| [Datasets](datasets.md) | Append extraction results into a durable table and export one merged CSV. |
| [Hosted service](hosted.md) | Sign-up, plans and quotas, usage metering, billing, bring-your-own key. |
| [Self-hosting](self-hosting.md) | Run Sift as a plain local server, or deploy your own hosted instance. |
| [Troubleshooting](troubleshooting.md) | Ollama issues, Gatekeeper warnings, wrong or empty values, quota errors, resetting local data. |
