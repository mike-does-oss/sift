import { contextBridge, ipcRenderer } from "electron";

/**
 * Exposed to the onboarding.html renderer only. Intentionally minimal: two
 * calls, both invoked over ipcRenderer.invoke so the renderer never touches
 * Node/Electron internals directly (contextIsolation stays on).
 */
contextBridge.exposeInMainWorld("sift", {
  checkOllama: (): Promise<{ running: boolean; models: string[] }> =>
    ipcRenderer.invoke("sift:check-ollama"),
  continueAnyway: (): void => {
    ipcRenderer.invoke("sift:continue-anyway");
  },
});
