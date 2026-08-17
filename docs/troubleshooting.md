# Troubleshooting

## Ollama not reachable

Symptoms: the provider list says "Ollama not running", or extractions with the Ollama provider fail immediately.

- Check the daemon: `ollama list` in a terminal (or just launch the Ollama app). Sift probes `http://localhost:11434` with a short timeout — if Ollama is slow to answer or not running, it's reported as down.
- Running Ollama somewhere else (another port, another machine)? Set the base URL in **Settings** and use **Test connection**.
- Make sure a model is pulled (`ollama pull gemma3:4b`); an empty model list means Ollama is up but has nothing to run.

## First local extraction is slow

Ollama loads a model into memory on its first request after startup, so the first extraction can take noticeably longer than the rest — tens of seconds for the larger models. Subsequent runs are much faster while the model stays warm. If every run is slow, the model may be too big for your hardware: see the [hardware recommendations](providers.md#hardware-recommendations) and try a smaller tag (`gemma3:4b` or `gemma3:1b`).

## macOS says the app is from an unidentified developer

The desktop build is currently unsigned, so Gatekeeper blocks a plain double-click on first launch. Right-click `Sift.app` → **Open** → **Open**. The install script avoids this by clearing the quarantine flag during install. See [Desktop app](desktop.md#unsigned-build-and-gatekeeper).

## Extraction returned wrong or empty values

- **Add field descriptions.** A one-line description per field ("Money out; null if this row is a credit") is the single most effective fix — the model reads it as instructions.
- **Turn on grounded mode.** Every value then comes with the source quote it was lifted from, and ungrounded values are flagged "verify manually" — which tells you whether the model misread the document or invented the value. See [Grounded mode](extraction.md#grounded-mode).
- **Add examples.** A saved template can carry up to 5 sample outputs that show the model the expected shape and formatting — this especially helps small local models.
- **All values empty on a scanned PDF?** Text-only providers (Ollama, OpenAI-compatible) need a text layer. Use a cloud provider that reads PDFs natively, or upload the page as an image to a local vision model.
- **Values missing from the end of a long document?** Text-shaped sources are capped at 40,000 characters — if the document view ends with `[document truncated]`, fields past the cut can't extract. Split the document.
- **Try a bigger model.** `gemma3:1b` is fast but weak; step up a tier or run the document against a cloud model from the per-request picker to compare.

## Quota errors (hosted)

"Monthly limit reached" (or a batch refusing to start) means your plan's monthly extraction quota is used up. Options: upgrade the plan, add your own Anthropic API key in Settings (BYO runs are quota-exempt), or wait for the month to roll over — the meter resets at the start of each UTC month. Failed extractions count toward the meter; retries of a queued job don't count extra. Details in [Usage metering](hosted.md#usage-metering).

## Where local data lives

- Running from source: `./data` inside the repo (override with `SIFT_DATA_DIR`) — the SQLite database is `data/sift.db`, uploaded documents sit alongside it.
- Desktop app: `~/Library/Application Support/Sift/data`.

This directory contains your documents, extraction history, and any API keys you entered (stored plaintext — it's a single-user local database). Treat it as sensitive, and include it in backups if you care about your history and datasets.

## Resetting the local database

Quit Sift (or stop the dev server), delete the data directory for your edition (above), and start it again. A fresh database is created automatically on startup. This erases everything: settings and keys, templates, documents, history, datasets, batches, and schedules. To keep a way back, rename the directory instead of deleting it.
