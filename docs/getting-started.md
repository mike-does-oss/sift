# Getting started

This page gets you from nothing to your first extraction on the local edition. For the hosted service, see [Hosted service](hosted.md).

## Install

**macOS (Apple Silicon) — desktop app, one command:**

```bash
curl -fsSL https://raw.githubusercontent.com/mike-does-oss/sift/main/install.sh | sh
```

This downloads the latest release to /Applications and launches it. See [Desktop app](desktop.md) for details, including the unsigned-build note.

**Any platform — run from source (Node 20+):**

```bash
git clone https://github.com/mike-does-oss/sift && cd sift
npm install
npm run dev
```

The app is at http://localhost:3000. A SQLite database auto-creates at `./data/sift.db` on first run — no separate database setup. The server binds to `127.0.0.1` only, so it's reachable from your machine alone (see [Self-hosting](self-hosting.md) for LAN exposure and the trade-offs).

## Set up a model

Sift extracts with Ollama by default, running entirely on your machine:

1. [Install Ollama](https://ollama.com).
2. `ollama pull gemma3:4b` (the default model — vision-capable, reads images and scanned pages).

No Ollama? Add an Anthropic, OpenAI, or Gemini API key in **Settings** instead. See [Providers and models](providers.md).

## Your first extraction

Open the dashboard. **Dashboard** is the overview; the extraction workspace lives at **Dashboard → Extract** (`/dashboard/extract`).

1. **Upload a document.** Drop a PDF, Word, PowerPoint, email, image, or text file into the workspace. The document renders on the left.
2. **Define fields.** On the right, add a field per value you want: a name, a type (text, number, date, boolean, array), and optionally a plain-language description that guides the model. Shortcuts:
   - Pick a preset template (invoices, receipts, bank statements, and more) from **Templates**.
   - Describe the task in plain language and let the model scaffold the fields and prompt for you.
   - Toggle **Extract multiple** if one document holds many records (e.g. every transaction on a statement) — you get one row per record.
3. **Run the extraction.** Extracted values appear in the results table, highlighted where they occur in the source text. The provider badge always shows whether the run was 🔒 Local or ☁ Cloud.
4. **Review and edit.** Click any value to edit it in place. Values that couldn't be found verbatim in the document are flagged for manual review. Exports always use your edited values.
5. **Export.** Copy JSON, download CSV, or download JSON — or append the rows to a [dataset](datasets.md) to build up a table across many documents.

Save the field configuration as a template when you're done, so the next document of the same kind is one click.

## Where to next

- [Extraction](extraction.md) — grounded mode, examples, formats, and size caps.
- [Templates, batches, and schedules](automation.md) — process many documents at once, or on a recurring cadence.
- [Providers and models](providers.md) — switch models per extraction, or bring cloud keys.
