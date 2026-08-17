# Providers and models

Which extraction engines are available depends on your edition:

- **Local / desktop**: Ollama (default), Anthropic, OpenAI, Gemini, and any OpenAI-compatible endpoint — your choice per request.
- **Hosted**: Claude only, with the model tier decided by your plan (see [Hosted models](#hosted-claude-only)).

## Local providers

### Ollama (default, fully local)

Documents never leave your machine. Setup:

1. [Install Ollama](https://ollama.com).
2. `ollama pull gemma3:4b` (the default model).
3. If Ollama isn't on the default `http://localhost:11434`, set the base URL in **Settings**.

Vision-capable models (gemma3:4b and up) also read images and scanned pages locally. Text-layer PDFs work with any model; scanned PDFs need a vision path — a local vision model reading page images, or a cloud provider that reads PDFs natively.

#### Hardware recommendations

Sift suggests a model based on your total system RAM (the desktop onboarding and the model-download flow both use this table):

| Total RAM | Recommended | Download | Vision |
|---|---|---|---|
| under 8 GB | `gemma3:1b` | 815 MB | no (text only) |
| 8–15 GB | `gemma3:4b` | 3.3 GB | yes |
| 16–31 GB | `gemma3:12b` | 8.1 GB | yes |
| 32 GB or more | `gemma3:27b` | ~17 GB | yes |

The larger models (`gemma3:12b`, `gemma3:27b`) can be slow without a dedicated GPU. Apple Silicon Macs are the exception — unified memory keeps large models responsive without a discrete GPU.

### Anthropic, OpenAI, Gemini (your API keys)

Add a key and model per provider in **Settings**. Defaults: `claude-sonnet-5` (Anthropic), `gpt-4o` (OpenAI), `gemini-2.0-flash` (Gemini). **Settings → Test connection** verifies a key before you rely on it.

Keys are stored in your local SQLite database on this machine — plaintext, single-user. There is no multi-user secret vault on the local edition; treat your data directory as sensitive (`./data` from source, `~/Library/Application Support/Sift/data` for the desktop app).

### Any OpenAI-compatible endpoint

Point the OpenAI-compatible provider at a base URL and model name — Groq, vLLM, LM Studio, or Ollama's own `/v1` endpoint all work. The API key is optional (many local servers don't need one).

### Per-request picker

The workspace has a provider/model picker on every extraction, so you can run one document against a different provider or model than your configured default without touching Settings. An always-visible badge shows where the request goes: 🔒 Local (Ollama) or ☁ Cloud. History records the provider and model for every job.

## Hosted: Claude only

On the hosted service, extraction always runs on Claude, and the model is a function of your plan — the per-request picker doesn't apply:

| Plan | Model |
|---|---|
| Free, Starter | `claude-haiku-4-5` |
| Pro, Business | `claude-sonnet-5` |

### Bring your own Anthropic key

Paid plans (Starter and up) can store their own Anthropic API key in **Settings**. While a key is stored:

- every extraction runs on `claude-opus-4-8` (the strongest tier), regardless of plan, and
- those extractions are quota-exempt — they don't count against your monthly limit.

The key is validated live against the Anthropic API when you save it, encrypted at rest (AES-256-GCM), and only ever shown back to you masked. Remove it any time to go back to the plan model on the platform key. Details in [Hosted service](hosted.md).
