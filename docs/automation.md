# Templates, batches, and schedules

One-off extractions live in the workspace (**Dashboard → Extract**). Everything here is about doing it repeatedly: saved templates, batch runs over many documents, and recurring schedules. Batches, schedules, and history share one page — **Dashboard → Runs** (`/dashboard/runs`), with a tab per view (`?tab=batches`, `?tab=schedules`, `?tab=history`).

## Templates

A template is a saved field configuration: fields, prompt, the extract-multiple flag, and optionally [few-shot examples](extraction.md#per-template-examples). The Templates page has two tabs:

- **Your templates** — templates you've saved, editable and deletable.
- **Examples** — 9 ready-made presets for common documents: bank statement transactions, bank statement summary, invoice, receipt, pay stub, purchase order line items, utility bill, résumé/CV, and contract key terms. Adding one copies it into your templates, where you can tweak it freely.

Batches and schedules run off a template. Batches snapshot the template at creation time, so editing a template later never changes in-flight or historical runs.

## Batches

A batch runs one template across many documents in the background.

1. Upload (or pick) the documents.
2. Choose a template and name the batch.
3. Create it — one extraction job per document is queued, and the batch page shows completed/failed counts as workers chew through them.

Failed jobs are retried automatically (up to 3 attempts per job). Results land in history per document, roll up on the batch detail page, and can be exported or written to an output folder (below).

**Hosted limits** (see [plans](hosted.md#plans-and-pricing)): batches require the Pro plan or higher — up to 25 files per batch on Pro, 100 on Business. The whole batch is checked against your remaining monthly quota up front, unless your own API key is active (BYO runs are quota-exempt). The local edition has no batch size limit.

## Schedules

A schedule is a recurring extraction: a template plus a cadence plus a document inbox. On the hosted service, schedules are a Business-plan feature; locally they're always available.

- **Cadence** — daily or weekly, at a chosen hour (UTC). Weekly schedules also pick a day of the week.
- **Inbox** — each schedule has its own document inbox. Drop documents in whenever; nothing runs yet.
- **Run** — when the scheduled time arrives, every unprocessed document in the inbox is queued for extraction with the schedule's template. Documents already processed on a previous run are skipped, so the inbox is append-only in practice.
- **Run now** — trigger the same thing manually from the schedule page without waiting for the cadence.

Locally, a background worker ticks once a minute while the app is running, so a due schedule fires within about a minute of its scheduled time — provided the app is open at that time. If the machine was off, the schedule fires on the next tick after it's due. On hosted, a platform cron does the same job.

On hosted, scheduled runs are metered like everything else: if your remaining quota can't cover the whole inbox, only that many documents are queued and the rest simply stay unprocessed (not failed) until quota frees up — unless your BYO key is active, in which case runs are quota-exempt. If your plan is downgraded below Business, existing schedules stop firing (and Run now is refused) but aren't deleted; they resume if you upgrade again.

## Output folders (local only)

Batches and schedules can auto-write their results to a folder on disk — useful when a schedule is feeding another tool. Not available on hosted (there's no server filesystem to write to), so the hosted forms don't show these options.

- **Folder** — an absolute path (`~` works, e.g. `~/Documents/sift-exports`). Created if missing.
- **Format** — `csv`, `json`, or `both`.
- **Written when the run finishes** — once every job in the batch (or scheduled run) has finished, one timestamped file per format is written, named `<batch or schedule name>-YYYYMMDD-HHMMSS.csv`/`.json`. Rows come from the successful jobs; each row carries a `_document` column with the source filename, followed by your fields in template order.
- **Keep results in app** — on by default. Turn it off to treat the output folder as the single destination: after the files are written, the stored result data for that run is cleared from the app (job status and history entries remain).
