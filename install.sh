#!/bin/sh
# Sift installer — macOS (Apple Silicon)
# Downloads the latest release, installs to /Applications, and launches it.
# Usage: curl -fsSL https://raw.githubusercontent.com/mike-whypred/sift/main/install.sh | sh
set -eu

REPO="mike-whypred/sift"
APP_NAME="Sift.app"
DEST="/Applications/$APP_NAME"

say() { printf '\033[32m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is macOS-only for now. On other platforms: git clone the repo and run 'npm install && npm run dev' (Node 20+)."
[ "$(uname -m)" = "arm64" ] || fail "Prebuilt app is Apple Silicon (arm64) only for now. On Intel Macs: git clone the repo and run 'npm run desktop:build' locally."

say "Finding the latest release…"
ASSET_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*arm64-mac\.zip"' \
  | head -1 | cut -d'"' -f4)
[ -n "$ASSET_URL" ] || fail "Couldn't find a mac zip in the latest release. See https://github.com/$REPO/releases"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "Downloading $(basename "$ASSET_URL")…"
curl -fL --progress-bar "$ASSET_URL" -o "$TMP/sift.zip"

say "Unpacking…"
ditto -xk "$TMP/sift.zip" "$TMP/unpacked"
[ -d "$TMP/unpacked/$APP_NAME" ] || fail "Unexpected archive layout."

if [ -d "$DEST" ]; then
  say "Replacing existing $DEST…"
  rm -rf "$DEST"
fi
mv "$TMP/unpacked/$APP_NAME" "$DEST"

# The build is unsigned; clearing the quarantine attribute skips the
# Gatekeeper "unidentified developer" block. You are choosing to trust
# this build — the source is fully open at https://github.com/mike-whypred/sift
say "Clearing quarantine flag (unsigned build)…"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

say "Installed to $DEST — launching."
open "$DEST"
say "Done. Your documents and data stay in ~/Library/Application Support/Sift/"
