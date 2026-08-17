<img src="public/logo.svg" alt="Sift logo" width="80">

# Sift

**Turn documents into structured data — locally, privately, on your terms.**

![AGPL-3.0 License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)

Sift is an open-source, self-hostable document extractor. Upload a PDF, Word, PowerPoint, email, image, or text file, define the fields you want in plain language, and get structured data back — reviewed, edited, and exported on your terms. It runs fully local by default (Ollama, documents never leave your machine) and never marks up your tokens: bring your own Anthropic, OpenAI, or Gemini key, or point it at any OpenAI-compatible endpoint.

- **Local-first and private** — an always-visible 🔒 Local / ☁ Cloud badge tells you exactly where each extraction runs.
- **No-code extraction** — fields are a name, a type, and a description; a model can even scaffold them from a task description. Grounded mode backs every value with the exact source quote.
- **Human-in-the-loop** — review and edit every value in place; exports and datasets always use your edits.
- **Scales past one document** — templates (with 9 ready-made presets), batch runs, recurring schedules with document inboxes, datasets that merge results into one CSV.

## Quick start

**macOS desktop app (Apple Silicon), one command:**

```bash
curl -fsSL https://raw.githubusercontent.com/mike-does-oss/sift/main/install.sh | sh
```

Downloads the latest release to /Applications and launches it. The build is unsigned for now — the script clears the quarantine flag for you (you're choosing to trust an open-source build you can read right here). Or grab an installer from [Releases](https://github.com/mike-does-oss/sift/releases) and right-click → Open on first launch.

**Or run from source (Node 20+):**

```bash
git clone https://github.com/mike-does-oss/sift && cd sift
npm install
npm run dev
```

The app is at http://localhost:3000, bound to localhost only. SQLite auto-creates on first run — no database setup. Then install [Ollama](https://ollama.com) and `ollama pull gemma3:4b`, or add a cloud API key in Settings.

## Documentation

Full guides live in [`docs/`](docs/README.md):

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install and your first extraction |
| [Desktop app](docs/desktop.md) | Install, data location, Ollama onboarding |
| [Providers and models](docs/providers.md) | Ollama, cloud keys, hardware recommendations |
| [Extraction](docs/extraction.md) | Fields, grounded mode, scaffolding, formats and caps |
| [Templates, batches, and schedules](docs/automation.md) | Automation and output folders |
| [Datasets](docs/datasets.md) | Durable result tables and merged CSV export |
| [Hosted service](docs/hosted.md) | Plans, metering, billing, BYO key |
| [Self-hosting](docs/self-hosting.md) | Plain local server or your own hosted deployment |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and fixes |

## Screenshots

**Workspace** — extract locally, watch values get lifted off the page:

![Extract playground](docs/screenshots/sift-dashboard.png)

**Settings** — pick a provider, manage keys, test the connection:

![Settings](docs/screenshots/sift-settings.png)

**History** — every job with the provider and model that ran it:

![History](docs/screenshots/sift-history.png)

**Schedules** — a document inbox processed on a daily or weekly cadence:

![Schedule detail](docs/screenshots/sift-schedule-detail.png)

## Comparison

| | Parseur / Parserr / Docparser | **Sift** |
|---|---|---|
| Hosting | Cloud only | Self-host or (later) hosted |
| Data locality | Leaves your infra | **Stays local** with Ollama |
| Pricing | Per-page toll (~3–10¢) | At-cost inference / free self-host |
| Model choice | Vendor-locked | **Any** — Ollama, Anthropic, OpenAI, Gemini, and any OpenAI-compatible endpoint |
| Source | Closed | **Open** |
| Setup for non-tech users | Strong | Parity target for v1 |

## License

[AGPL-3.0-or-later](LICENSE). Free to use, self-host, and modify; if you run a modified sift as a network service, you must offer its source to your users.
