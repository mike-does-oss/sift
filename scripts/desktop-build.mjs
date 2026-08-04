#!/usr/bin/env node
// Orchestrates the desktop build: next build -> copy standalone assets ->
// strip the traced dev data dir -> guard against a leaked sift.db -> compile
// electron/*.ts -> electron-builder.
//
// See .superpowers/sdd/task-d2-brief.md and
// docs/plans/2026-07-31-sift-desktop-a.md (Task D2) for why each step exists
// — in particular the sift.db guard: the standalone build traces the live
// dev `data/` directory (including the real on-disk SQLite DB with stored
// API keys) into `.next/standalone/data`. That must never ship.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { cp, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const standaloneDir = path.join(root, ".next", "standalone");

function step(label, fn) {
  console.log(`\n--- ${label} ---`);
  return fn();
}

function run(cmd, args) {
  // npx is npx.cmd on Windows; shell:true lets the platform resolve it.
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
}

async function findFilesNamed(dir, name) {
  const hits = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...(await findFilesNamed(full, name)));
    } else if (entry.name === name || entry.name.startsWith(`${name}-`)) {
      // matches sift.db, sift.db-shm, sift.db-wal
      hits.push(full);
    }
  }
  return hits;
}

async function main() {
  step("next build", () => run("npx", ["next", "build"]));

  await step("copy static assets into standalone bundle", async () => {
    const staticSrc = path.join(root, ".next", "static");
    const staticDest = path.join(standaloneDir, ".next", "static");
    await cp(staticSrc, staticDest, { recursive: true });

    const publicSrc = path.join(root, "public");
    const publicDest = path.join(standaloneDir, "public");
    if (existsSync(publicSrc)) {
      await cp(publicSrc, publicDest, { recursive: true });
    }
  });

  step("strip traced dev data dir from standalone bundle", () => {
    const dataDir = path.join(standaloneDir, "data");
    rmSync(dataDir, { recursive: true, force: true });
  });

  await step("guard: no sift.db anywhere in the bundle about to ship", async () => {
    const hits = await findFilesNamed(standaloneDir, "sift.db");
    if (hits.length > 0) {
      console.error("FATAL: found sift.db-related file(s) staged for packaging:");
      for (const hit of hits) console.error(`  ${hit}`);
      console.error(
        "This would ship the real local database (and any stored API keys) inside the desktop app. Aborting.",
      );
      process.exit(1);
    }
    console.log("OK — no sift.db found under .next/standalone");
  });

  await step("compile electron/*.ts -> dist-electron/*.cjs", async () => {
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
  });

  const platformFlag =
    process.platform === "darwin" ? "--mac" : process.platform === "win32" ? "--win" : "--linux";
  step("electron-builder", () => run("npx", ["electron-builder", platformFlag, "--publish", "never"]));

  console.log("\ndesktop:build complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
