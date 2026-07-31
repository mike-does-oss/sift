#!/usr/bin/env node
// Dev-mode desktop shell: compiles electron/*.ts, boots `next dev`, waits for
// it to answer, then launches Electron pointed at it. No extra process
// manager dependency — this replaces what `concurrently` would do.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const devUrl = process.env.SIFT_DEV_URL ?? "http://127.0.0.1:3000";
const devPort = new URL(devUrl).port || "3000";

async function compileElectron() {
  const outdir = path.join(root, "dist-electron");
  mkdirSync(outdir, { recursive: true });
  await esbuild.build({
    entryPoints: {
      main: path.join(root, "electron", "main.ts"),
      preload: path.join(root, "electron", "preload.ts"),
    },
    outdir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
    sourcemap: true,
  });
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  await compileElectron();

  // Explicit -p (and a scrubbed PORT env) so an ambient PORT env var can't
  // send next dev to a different port than SIFT_DEV_URL points Electron at.
  const envWithoutPort = { ...process.env };
  delete envWithoutPort.PORT;
  const nextDev = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", devPort], {
    cwd: root,
    stdio: "inherit",
    env: envWithoutPort,
  });

  const cleanup = () => {
    if (!nextDev.killed) nextDev.kill();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  try {
    await waitForUrl(devUrl, 30_000);
  } catch (err) {
    console.error(err.message);
    cleanup();
    process.exit(1);
  }

  const electronBin = path.join(root, "node_modules", ".bin", "electron");
  const electronProc = spawn(electronBin, [path.join(root, "dist-electron", "main.cjs")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, SIFT_DEV_URL: devUrl },
  });

  electronProc.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
