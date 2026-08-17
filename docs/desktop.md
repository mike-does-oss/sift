# Desktop app

The desktop app is a native window around the same Sift server, started and managed for you — no terminal required after install.

## Install

**One command (macOS, Apple Silicon):**

```bash
curl -fsSL https://raw.githubusercontent.com/mike-does-oss/sift/main/install.sh | sh
```

The script downloads the latest release, installs it to `/Applications/Sift.app`, clears the quarantine flag, and launches the app. The installer is macOS/Apple Silicon only; on Intel Macs, build it yourself (below).

**From the releases page:** grab an artifact from [Releases](https://github.com/mike-does-oss/sift/releases) — a `.dmg`/`.zip` for macOS (arm64), a `.exe` for Windows, or an `.AppImage` for Linux.

**Build it yourself:**

```bash
npm run desktop:build
```

This produces an unsigned `Sift.app` (plus `.dmg`/`.zip`) in `dist-desktop/`. `npm run desktop:dev` runs the desktop shell against the dev server.

### Unsigned build and Gatekeeper

The builds are currently unsigned, so on first launch macOS Gatekeeper warns about an "unidentified developer". Either:

- let the install script handle it (it removes the `com.apple.quarantine` attribute for you), or
- right-click the app → **Open** on first launch.

Either way you are choosing to trust an open-source build whose source you can read in this repository. Signed installers and auto-update are on the roadmap.

## Where your data lives

The desktop app keeps everything under:

```
~/Library/Application Support/Sift/data
```

That directory holds the SQLite database and your uploaded documents. Treat it as sensitive — it also stores any API keys you enter in Settings (see [Providers and models](providers.md)). Deleting it resets the app to a fresh state.

## Ollama onboarding

On launch, the app checks for a local Ollama daemon at `http://127.0.0.1:11434`. If Ollama isn't running, you get an onboarding screen instead of the dashboard:

1. **Install Ollama** — a link to [ollama.com](https://ollama.com).
2. **Pull a model** — a copyable `ollama pull` command. The suggested model is picked for your machine's RAM (see the [hardware recommendations](providers.md#hardware-recommendations)).
3. **Continue without local models** — skip straight to the dashboard and use cloud API keys instead.

Once Ollama is detected, the app opens the dashboard directly.
