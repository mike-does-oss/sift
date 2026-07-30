# Sift

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

Open-source, self-hostable document extractor that runs fully local by default (Ollama) and never marks up your tokens (BYO cloud key).

## Quick start

```bash
git clone https://github.com/yourname/sift && cd sift
npm install
npm run dev
```

Requires Node 20+. SQLite auto-creates at `./data/sift.db` on first run — no separate database setup. The app is at http://localhost:3000.

### Localhost only, by default

There is no auth. `npm run dev` / `npm start` bind to `127.0.0.1` only, so the app is reachable from this machine alone. If you want LAN access anyway, run `next dev -H 0.0.0.0` (or `next start -H 0.0.0.0`, or your own interface) — at your own risk, since anyone who can reach that address can read your extraction history, spend your BYO API key, and edit your settings.

## Provider setup

### Ollama (default, local)

1. [Install Ollama](https://ollama.com).
2. `ollama pull gemma3:4b`.
3. If Ollama isn't running on the default `http://localhost:11434`, set the base URL in Settings.

v0 does text-only PDF extraction locally. Scanned or image-only PDFs need a cloud provider for now.

### Anthropic / OpenAI (BYO key)

Add your API key and model in Settings. Keys are stored in your local SQLite database on this machine — plaintext, single-user; treat `./data` as sensitive.

## Privacy

In local (Ollama) mode, documents never leave your machine. With a cloud provider, document content goes to that provider only — there is no third-party server of ours involved.

## Features

- Extraction playground with 9 preset templates (invoices, receipts, bank statements, pay stubs, purchase orders, utility bills, résumés, contracts)
- Batches
- Recurring schedules with document inboxes and Run now
- History with provider/model recorded per job
- CSV/JSON export
- Provider settings with test-connection

## Comparison

| | Parseur / Parserr / Docparser | **Sift** |
|---|---|---|
| Hosting | Cloud only | Self-host or (later) hosted |
| Data locality | Leaves your infra | **Stays local** with Ollama |
| Pricing | Per-page toll (~3–10¢) | At-cost inference / free self-host |
| Model choice | Vendor-locked | **Any** — Ollama, Anthropic, OpenAI today; Gemini + OpenAI-compatible planned |
| Source | Closed | **Open** |
| Setup for non-tech users | Strong | Parity target for v1 |

## Screenshots

**Extract playground** — upload a PDF, define fields, extract locally:

![Extract playground](docs/screenshots/sift-dashboard.png)

**Settings** — pick a provider, manage keys, test the connection:

![Settings](docs/screenshots/sift-settings.png)

**History** — every job with the provider and model that ran it:

![History](docs/screenshots/sift-history.png)

**Schedules** — a document inbox processed on a daily or weekly cadence:

![Schedule detail](docs/screenshots/sift-schedule-detail.png)

## License

MIT
