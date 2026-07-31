import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { promises as fsp } from "fs";
import net from "net";
import path from "path";
import { detectOllama } from "./ollama";

const DEV_URL_DEFAULT = "http://127.0.0.1:3000";
const READY_TIMEOUT_MS = 30_000;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(main);
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  killServer();
});

function killServer(): void {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// External link handling
// ---------------------------------------------------------------------------

function isInternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return true;
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return true;
    return false;
  } catch {
    return false;
  }
}

function wireExternalLinks(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

// ---------------------------------------------------------------------------
// Dashboard load + optional E2E screenshot
// ---------------------------------------------------------------------------

async function loadDashboard(win: BrowserWindow, url: string): Promise<void> {
  await new Promise<void>((resolve) => {
    win.webContents.once("did-finish-load", () => {
      void maybeCaptureE2EShot(win).finally(resolve);
    });
    void win.loadURL(url);
  });
}

async function maybeCaptureE2EShot(win: BrowserWindow): Promise<void> {
  const shotPath = process.env.SIFT_E2E_SHOT;
  if (!shotPath) return;
  try {
    const image = await win.webContents.capturePage();
    await fsp.writeFile(shotPath, image.toPNG());
    console.log("[e2e] shot written");
  } catch (err) {
    console.error("[e2e] failed to capture shot:", err);
  }
}

// ---------------------------------------------------------------------------
// Packaged-mode server process (ABI decision: ELECTRON_RUN_AS_NODE fork of
// the Electron binary — see docs/plans/2026-07-31-sift-desktop-a.md Task D2
// and .superpowers/sdd/task-d2-brief.md. Verified empirically: better-sqlite3
// ships N-API prebuilds, so the traced prebuild loads unmodified under
// ELECTRON_RUN_AS_NODE=1 with no ABI rebuild step.)
// ---------------------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const { port } = address;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("Could not acquire a free port"));
      }
    });
  });
}

function startServer(port: number, dataDir: string): ChildProcess {
  const serverDir = path.join(process.resourcesPath, "server");
  const serverJs = path.join(serverDir, "server.js");
  const migrationsDir = path.join(serverDir, "drizzle");

  const child = spawn(process.execPath, [serverJs], {
    cwd: serverDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      SIFT_DATA_DIR: dataDir,
      SIFT_MIGRATIONS_DIR: migrationsDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[server] ${chunk.toString().trimEnd()}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[server] ${chunk.toString().trimEnd()}`);
  });
  child.on("exit", (code, signal) => {
    console.log(`[server] exited (code=${code}, signal=${signal})`);
  });

  return child;
}

async function waitForServerReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || (res.status >= 300 && res.status < 500)) return;
    } catch {
      // server not accepting connections yet — retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not respond within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Ollama onboarding IPC
// ---------------------------------------------------------------------------

function wireOllamaIpc(win: BrowserWindow, dashboardUrl: string): void {
  ipcMain.handle("sift:check-ollama", async () => {
    const result = await detectOllama();
    if (result.running) {
      await loadDashboard(win, dashboardUrl);
    }
    return result;
  });

  ipcMain.handle("sift:continue-anyway", async () => {
    await loadDashboard(win, dashboardUrl);
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
  });
  wireExternalLinks(win);

  if (!app.isPackaged) {
    const devUrl = process.env.SIFT_DEV_URL ?? DEV_URL_DEFAULT;
    await loadDashboard(win, devUrl);
    return;
  }

  const dataDir = path.join(app.getPath("userData"), "data");

  let port: number;
  try {
    port = await findFreePort();
    serverProcess = startServer(port, dataDir);
    await waitForServerReady(`http://127.0.0.1:${port}/`, READY_TIMEOUT_MS);
  } catch (err) {
    dialog.showErrorBox("Sift failed to start", String(err));
    app.quit();
    return;
  }

  const dashboardUrl = `http://127.0.0.1:${port}/dashboard`;
  wireOllamaIpc(win, dashboardUrl);

  const ollama = await detectOllama();
  if (ollama.running) {
    await loadDashboard(win, dashboardUrl);
  } else {
    await win.loadFile(path.join(__dirname, "..", "electron", "onboarding.html"));
  }
}
