import { contextBridge, ipcRenderer } from "electron";

/**
 * Exposed to the onboarding.html renderer only. Intentionally minimal: three
 * calls, all invoked over ipcRenderer.invoke so the renderer never touches
 * Node/Electron internals directly (contextIsolation stays on).
 */
contextBridge.exposeInMainWorld("sift", {
  checkOllama: (): Promise<{ running: boolean; models: string[] }> =>
    ipcRenderer.invoke("sift:check-ollama"),
  continueAnyway: (): void => {
    ipcRenderer.invoke("sift:continue-anyway");
  },
  // Read-only: hardware-sized model pick for the onboarding pull command.
  getRecommendedModel: (): Promise<{ model: string; downloadSize: string }> =>
    ipcRenderer.invoke("sift:get-recommended-model"),
});
