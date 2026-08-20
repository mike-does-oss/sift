"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  HardDrive,
  Sparkles,
  Cloud,
  Zap,
  Plug,
  Check,
  Download,
} from "lucide-react";
import type { SiftSettings } from "@/lib/settings";
import { webSiftApi } from "@/lib/api";
import { createPullProgressTracker } from "@/lib/pull-progress";
import { normalizeModelTag, isModelInstalled, type SystemInfo, type ModelRec } from "@/lib/model-recommend";

type Provider = SiftSettings["provider"];

const PROVIDERS: {
  value: Provider;
  label: string;
  icon: typeof HardDrive;
  description: string;
}[] = [
  {
    value: "ollama",
    label: "Ollama (Local)",
    icon: HardDrive,
    description: "Runs on your machine — private and free, no API key needed.",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    icon: Sparkles,
    description: "Claude models via your own Anthropic API key.",
  },
  {
    value: "openai",
    label: "OpenAI",
    icon: Cloud,
    description: "GPT models via your own OpenAI API key.",
  },
  {
    value: "gemini",
    label: "Gemini",
    icon: Zap,
    description: "Gemini models via your own Google AI Studio API key.",
  },
  {
    value: "openai-compatible",
    label: "OpenAI-compatible",
    icon: Plug,
    description: "Any OpenAI-compatible endpoint — Groq, vLLM, LM Studio, Ollama's OpenAI mode…",
  },
];

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; models?: string[] }
  | { status: "error"; error: string };

type PullState =
  | { status: "idle" }
  | { status: "pulling"; model: string; percent: number | null; statusText: string }
  | { status: "success" }
  | { status: "error"; error: string };

function PullProgressBar({ state }: { state: PullState }) {
  if (state.status === "pulling") {
    return (
      <div className="space-y-1">
        <div className="h-1.5 rounded-[2px] bg-[var(--well)] border border-[var(--hairline)] overflow-hidden">
          <div
            className={`h-full bg-[var(--phosphor)] transition-all ${
              state.percent === null ? "w-1/3 animate-pulse" : ""
            }`}
            style={state.percent !== null ? { width: `${state.percent}%` } : undefined}
          />
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          <span className="font-mono">{state.model}</span> · {state.statusText}
          {state.percent !== null ? ` · ${state.percent}%` : ""}
        </p>
      </div>
    );
  }
  if (state.status === "success") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-[var(--success)]">
        <Check className="w-3.5 h-3.5" /> Downloaded — refreshing models…
      </p>
    );
  }
  if (state.status === "error") {
    return <p className="text-xs text-[var(--error)]">{state.error}</p>;
  }
  return null;
}

function TestConnectionButton({
  label,
  state,
  onTest,
}: {
  label: string;
  state: TestState;
  onTest: () => void;
}) {
  return (
    <button
      onClick={onTest}
      disabled={state.status === "testing"}
      className="px-3 py-2 rounded border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-50"
    >
      {state.status === "testing" ? "Testing…" : label}
    </button>
  );
}

function TestResult({ state }: { state: TestState }) {
  if (state.status === "ok") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-[var(--success)]">
        <Check className="w-3.5 h-3.5" /> Connected
      </p>
    );
  }
  if (state.status === "error") {
    return <p className="text-xs text-[var(--error)]">{state.error}</p>;
  }
  return null;
}

// The complete local-profile Settings page, moved verbatim from page.tsx in
// §SaaS-1 T6 (page.tsx is now the server-side profile switch). Markup and
// behavior are unchanged — the local profile must stay pixel-equivalent.
export default function LocalSettingsPage() {
  const [loaded, setLoaded] = useState<SiftSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [provider, setProvider] = useState<Provider>("ollama");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [compatBaseUrl, setCompatBaseUrl] = useState("");
  const [compatModel, setCompatModel] = useState("");

  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const [anthropicRemoveKey, setAnthropicRemoveKey] = useState(false);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [openaiRemoveKey, setOpenaiRemoveKey] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [geminiRemoveKey, setGeminiRemoveKey] = useState(false);
  const [compatKeyInput, setCompatKeyInput] = useState("");
  const [compatRemoveKey, setCompatRemoveKey] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [ollamaTest, setOllamaTest] = useState<TestState>({ status: "idle" });
  const [pullState, setPullState] = useState<PullState>({ status: "idle" });
  const pullAbortRef = useRef<AbortController | null>(null);
  const [systemInfo, setSystemInfo] = useState<{ system: SystemInfo; recommendations: ModelRec[] } | null>(null);
  // Installed Ollama model tags, sourced from GET /api/providers (same
  // /api/tags data `webSiftApi.listProviders()` already exposes) — the one
  // source of truth "installed" state reads from. `null` means unknown
  // (Ollama unreachable, or not checked yet), not "nothing installed":
  // recommendation rows fall back to a plain Download button rather than
  // implying a false "not installed".
  const [installedModels, setInstalledModels] = useState<string[] | null>(null);
  const [anthropicTest, setAnthropicTest] = useState<TestState>({ status: "idle" });
  const [openaiTest, setOpenaiTest] = useState<TestState>({ status: "idle" });
  const [geminiTest, setGeminiTest] = useState<TestState>({ status: "idle" });
  const [compatTest, setCompatTest] = useState<TestState>({ status: "idle" });

  const applyLoaded = useCallback((s: SiftSettings) => {
    setLoaded(s);
    setProvider(s.provider);
    setOllamaBaseUrl(s.ollamaBaseUrl);
    setOllamaModel(s.ollamaModel);
    setAnthropicModel(s.anthropicModel);
    setOpenaiModel(s.openaiModel);
    setGeminiModel(s.geminiModel);
    setCompatBaseUrl(s.compatBaseUrl);
    setCompatModel(s.compatModel);
    setAnthropicKeyInput("");
    setAnthropicRemoveKey(false);
    setOpenaiKeyInput("");
    setOpenaiRemoveKey(false);
    setGeminiKeyInput("");
    setGeminiRemoveKey(false);
    setCompatKeyInput("");
    setCompatRemoveKey(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        applyLoaded(data.settings);
      }
    } catch {
      // convenience readout — ignore transient failures
    } finally {
      setIsLoading(false);
    }
  }, [applyLoaded]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        setSystemInfo(await webSiftApi.getSystemInfo());
      } catch {
        // best-effort hint — the free-text field + button below still work
      }
    })();
  }, []);

  const refreshInstalledModels = useCallback(async () => {
    try {
      const providers = await webSiftApi.listProviders();
      const ollama = providers.find((p) => p.id === "ollama");
      // A `note` on the ollama entry (e.g. "Ollama not running") means the
      // list couldn't be read — keep installed state unknown rather than
      // treating an empty list as "nothing installed".
      setInstalledModels(ollama && !ollama.note ? ollama.models : null);
    } catch {
      setInstalledModels(null);
    }
  }, []);

  // Installed-state is best-effort and non-blocking: fetch on mount so
  // recommendation rows already know what's installed before the user
  // touches "Detect models" / "Test connection" (see also runTest below,
  // which refreshes this from the same /api/tags data after a successful
  // detect/test or pull).
  useEffect(() => {
    (async () => {
      await refreshInstalledModels();
    })();
  }, [refreshInstalledModels]);

  const hasChanges =
    !!loaded &&
    (provider !== loaded.provider ||
      ollamaBaseUrl !== loaded.ollamaBaseUrl ||
      ollamaModel !== loaded.ollamaModel ||
      anthropicModel !== loaded.anthropicModel ||
      openaiModel !== loaded.openaiModel ||
      geminiModel !== loaded.geminiModel ||
      compatBaseUrl !== loaded.compatBaseUrl ||
      compatModel !== loaded.compatModel ||
      anthropicKeyInput.length > 0 ||
      anthropicRemoveKey ||
      openaiKeyInput.length > 0 ||
      openaiRemoveKey ||
      geminiKeyInput.length > 0 ||
      geminiRemoveKey ||
      compatKeyInput.length > 0 ||
      compatRemoveKey);

  const handleSave = async () => {
    if (!loaded) return;
    setIsSaving(true);
    setSaveStatus("idle");
    setSaveError(null);
    try {
      const patch: Record<string, string> = {};
      if (provider !== loaded.provider) patch.provider = provider;
      if (ollamaBaseUrl !== loaded.ollamaBaseUrl) patch.ollamaBaseUrl = ollamaBaseUrl;
      if (ollamaModel !== loaded.ollamaModel) patch.ollamaModel = ollamaModel;
      if (anthropicModel !== loaded.anthropicModel) patch.anthropicModel = anthropicModel;
      if (openaiModel !== loaded.openaiModel) patch.openaiModel = openaiModel;
      if (geminiModel !== loaded.geminiModel) patch.geminiModel = geminiModel;
      if (compatBaseUrl !== loaded.compatBaseUrl) patch.compatBaseUrl = compatBaseUrl;
      if (compatModel !== loaded.compatModel) patch.compatModel = compatModel;
      if (anthropicRemoveKey) patch.anthropicApiKey = "";
      else if (anthropicKeyInput) patch.anthropicApiKey = anthropicKeyInput;
      if (openaiRemoveKey) patch.openaiApiKey = "";
      else if (openaiKeyInput) patch.openaiApiKey = openaiKeyInput;
      if (geminiRemoveKey) patch.geminiApiKey = "";
      else if (geminiKeyInput) patch.geminiApiKey = geminiKeyInput;
      if (compatRemoveKey) patch.compatApiKey = "";
      else if (compatKeyInput) patch.compatApiKey = compatKeyInput;

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Could not save settings.");
        setSaveStatus("error");
        return;
      }
      applyLoaded(data.settings);
      setSaveStatus("saved");
      window.dispatchEvent(new Event("settings-changed"));
      setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2500);
    } catch {
      setSaveError("Could not save settings.");
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  // Gives clicking a default-provider card a visible consequence beyond the
  // selection border: it jumps you straight to that provider's configuration
  // section below, which also happens to be `id`-matched to `Provider`
  // values (see the `<section id="...">` on each config card further down).
  const scrollToProviderSection = (value: Provider) => {
    const el = document.getElementById(value);
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const handleSelectProvider = (value: Provider) => {
    setProvider(value);
    scrollToProviderSection(value);
  };

  const runTest = async (
    testProvider: Provider,
    setState: (s: TestState) => void
  ) => {
    setState({ status: "testing" });
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: testProvider }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setState({ status: "error", error: data.error || "Test failed." });
        if (testProvider === "ollama") setInstalledModels(null);
        return;
      }
      setState({ status: "ok", models: data.models });
      // "Detect models"/"Test connection" hit the same /api/tags data as
      // refreshInstalledModels — reuse this response instead of a redundant
      // second fetch, so installed-state also updates on manual detect.
      if (testProvider === "ollama") setInstalledModels(data.models ?? []);
    } catch {
      setState({ status: "error", error: "Could not reach the server." });
      if (testProvider === "ollama") setInstalledModels(null);
    }
  };

  // Aborting on unmount stops the in-flight fetch/stream read if the user
  // navigates away mid-download. Ollama caches layers it has already
  // fetched, so a re-click on "Download model" resumes rather than
  // restarting from zero.
  useEffect(() => {
    return () => {
      pullAbortRef.current?.abort();
    };
  }, []);

  // `modelArg` lets a "Recommended for this machine" row download a specific
  // tag without first requiring the user to type it into the model field —
  // on success we fill the field with whatever was downloaded either way.
  const handlePullModel = async (modelArg?: string) => {
    const model = (modelArg ?? ollamaModel).trim();
    if (!model || pullState.status === "pulling") return;

    const controller = new AbortController();
    pullAbortRef.current = controller;
    const tracker = createPullProgressTracker();
    setPullState({ status: "pulling", model, percent: null, statusText: "Starting…" });

    try {
      await webSiftApi.pullModel(
        model,
        (progress) => {
          const { status, percent } = tracker.update(progress);
          setPullState({ status: "pulling", model, percent, statusText: status });
        },
        controller.signal
      );
      setPullState({ status: "success" });
      setOllamaModel(model);
      await runTest("ollama", setOllamaTest);
      setTimeout(() => setPullState((s) => (s.status === "success" ? { status: "idle" } : s)), 2500);
    } catch (err) {
      if (controller.signal.aborted) return; // deliberate navigation-away abort, not a real failure
      setPullState({ status: "error", error: err instanceof Error ? err.message : "Download failed." });
    }
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="h-6 w-40 rounded bg-[var(--surface-overlay)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-2xl text-[var(--text-primary)] flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-[var(--ink-dim)]" />
          Settings
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          Choose your extraction provider and manage API keys.
        </p>
      </div>

      {/* Provider selection */}
      <section className="card-elevated p-5 space-y-4">
        <div>
          <h2 className="etched-label">Default Provider</h2>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Used for every extraction unless you pick another in the workspace.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((p) => {
            const Icon = p.icon;
            const isSelected = provider === p.value;
            return (
              <button
                key={p.value}
                onClick={() => handleSelectProvider(p.value)}
                className={`text-left rounded-md border p-4 transition-all ${
                  isSelected
                    ? "border-[var(--phosphor-dim)] bg-[var(--phosphor-well)]"
                    : "border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--surface-overlay)]"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon
                    className={`w-4 h-4 ${
                      isSelected ? "text-[var(--phosphor)]" : "text-[var(--text-tertiary)]"
                    }`}
                  />
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {p.label}
                  </span>
                  {isSelected && (
                    // Same recipe as the "Recommended" badge (machined 4px chip,
                    // 10px mono caps) — but phosphor-bordered: "Default" IS the
                    // live selection, the one state phosphor is for. Filled with
                    // --panel so the chip reads against the phosphor-well card.
                    <span className="data px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--phosphor-dim)] text-[10px] font-medium text-[var(--phosphor)] uppercase tracking-wide">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-tertiary)]">{p.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Ollama */}
      <section id="ollama" className="card-elevated p-5 space-y-4 scroll-mt-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[var(--well)] flex items-center justify-center border border-[var(--hairline)] flex-shrink-0">
            <HardDrive className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
          <h2 className="etched-label">Ollama (Local)</h2>
        </div>

        {systemInfo && systemInfo.recommendations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--text-secondary)]">
              Recommended for this machine
            </p>
            <div className="space-y-2">
              {systemInfo.recommendations.map((rec) => {
                const isPullingThis = pullState.status === "pulling" && pullState.model === rec.model;
                // `installedModels === null` means unknown (Ollama unreachable, or not
                // checked yet) — keep the plain Download button rather than implying a
                // false "not installed".
                const isInstalled = installedModels !== null && isModelInstalled(rec.model, installedModels);
                const isSelected = isInstalled && normalizeModelTag(rec.model) === normalizeModelTag(ollamaModel.trim());
                return (
                  <div
                    key={rec.model}
                    className="flex items-center gap-3 rounded border border-[var(--border-subtle)] p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-[var(--text-primary)]">{rec.model}</span>
                        <span className="text-xs text-[var(--text-tertiary)]">{rec.downloadSize}</span>
                        {rec.vision && (
                          <span className="data px-1.5 py-0.5 rounded bg-[var(--surface-overlay)] text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
                            Vision
                          </span>
                        )}
                        {rec.recommended && (
                          <span className="data px-1.5 py-0.5 rounded border border-[var(--hairline-strong)] bg-[var(--surface-overlay)] text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                        {rec.reason}
                        {rec.caveat ? ` ${rec.caveat}` : ""}
                      </p>
                    </div>
                    {isInstalled ? (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="flex items-center gap-1.5 px-2.5 py-2 rounded bg-[var(--surface-overlay)] text-xs font-medium text-[var(--text-secondary)]">
                          <span className="led led-on" aria-hidden />
                          Installed
                        </span>
                        <button
                          onClick={() => setOllamaModel(rec.model)}
                          disabled={isSelected}
                          className="px-3 py-2 rounded border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-50"
                        >
                          {isSelected ? "Selected" : "Use"}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handlePullModel(rec.model)}
                        disabled={pullState.status === "pulling"}
                        className="flex items-center gap-1.5 px-3 py-2 rounded border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {isPullingThis ? "Downloading…" : "Download"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Base URL
            </label>
            <input
              type="text"
              value={ollamaBaseUrl}
              onChange={(e) => setOllamaBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full px-3 py-2 input-base text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Model <span className="text-[var(--text-tertiary)] normal-case">(or type any model name)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                placeholder="gemma3:4b"
                className="flex-1 min-w-0 px-3 py-2 input-base text-sm font-mono"
              />
              <button
                onClick={() => handlePullModel()}
                disabled={pullState.status === "pulling" || !ollamaModel.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-50 flex-shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                {pullState.status === "pulling" && pullState.model === ollamaModel.trim()
                  ? "Downloading…"
                  : installedModels !== null && ollamaModel.trim() && isModelInstalled(ollamaModel.trim(), installedModels)
                    ? "Re-download"
                    : "Download model"}
              </button>
            </div>
          </div>
        </div>

        <PullProgressBar state={pullState} />

        <div className="flex flex-wrap items-center gap-2">
          <TestConnectionButton
            label="Detect models"
            state={ollamaTest}
            onTest={() => runTest("ollama", setOllamaTest)}
          />
          <TestConnectionButton
            label="Test connection"
            state={ollamaTest}
            onTest={() => runTest("ollama", setOllamaTest)}
          />
        </div>

        {ollamaTest.status === "ok" && ollamaTest.models && ollamaTest.models.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ollamaTest.models.map((m) => (
              <button
                key={m}
                onClick={() => setOllamaModel(m)}
                className="data px-2.5 py-1 rounded bg-[var(--surface-overlay)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--phosphor-well)] hover:text-[var(--text-primary)] transition-colors"
              >
                {m}
              </button>
            ))}
          </div>
        )}
        {ollamaTest.status === "ok" && (!ollamaTest.models || ollamaTest.models.length === 0) && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--success)]">
            <Check className="w-3.5 h-3.5" /> Connected — no models found
          </p>
        )}
        {ollamaTest.status === "error" && (
          <p className="text-xs text-[var(--error)]">{ollamaTest.error}</p>
        )}
      </section>

      {/* Anthropic */}
      <section id="anthropic" className="card-elevated p-5 space-y-4 scroll-mt-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[var(--well)] flex items-center justify-center border border-[var(--hairline)] flex-shrink-0">
            <Sparkles className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
          <h2 className="etched-label">Anthropic</h2>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Model
          </label>
          <input
            type="text"
            value={anthropicModel}
            onChange={(e) => setAnthropicModel(e.target.value)}
            placeholder="claude-sonnet-5"
            className="w-full px-3 py-2 input-base text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            API key
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={anthropicKeyInput}
              onChange={(e) => {
                setAnthropicKeyInput(e.target.value);
                if (anthropicRemoveKey) setAnthropicRemoveKey(false);
              }}
              placeholder={
                anthropicRemoveKey ? "" : loaded?.anthropicApiKey || "sk-ant-..."
              }
              autoComplete="off"
              className="flex-1 px-3 py-2 input-base text-sm font-mono"
            />
            {loaded?.anthropicApiKey && !anthropicRemoveKey && (
              <button
                onClick={() => setAnthropicRemoveKey(true)}
                className="px-3 py-2 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors flex-shrink-0"
              >
                Remove key
              </button>
            )}
            {anthropicRemoveKey && (
              <button
                onClick={() => setAnthropicRemoveKey(false)}
                className="px-3 py-2 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
              >
                Cancel
              </button>
            )}
          </div>
          {anthropicRemoveKey && (
            <p className="text-xs text-[var(--error)] mt-1.5">
              Key will be removed when you save.
            </p>
          )}
          <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
            Keys are stored in your local database on this machine.
          </p>
        </div>

        <div className="space-y-2">
          <TestConnectionButton
            label="Test connection"
            state={anthropicTest}
            onTest={() => runTest("anthropic", setAnthropicTest)}
          />
          <TestResult state={anthropicTest} />
        </div>
      </section>

      {/* OpenAI */}
      <section id="openai" className="card-elevated p-5 space-y-4 scroll-mt-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[var(--well)] flex items-center justify-center border border-[var(--hairline)] flex-shrink-0">
            <Cloud className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
          <h2 className="etched-label">OpenAI</h2>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Model
          </label>
          <input
            type="text"
            value={openaiModel}
            onChange={(e) => setOpenaiModel(e.target.value)}
            placeholder="gpt-4o"
            className="w-full px-3 py-2 input-base text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            API key
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={openaiKeyInput}
              onChange={(e) => {
                setOpenaiKeyInput(e.target.value);
                if (openaiRemoveKey) setOpenaiRemoveKey(false);
              }}
              placeholder={openaiRemoveKey ? "" : loaded?.openaiApiKey || "sk-..."}
              autoComplete="off"
              className="flex-1 px-3 py-2 input-base text-sm font-mono"
            />
            {loaded?.openaiApiKey && !openaiRemoveKey && (
              <button
                onClick={() => setOpenaiRemoveKey(true)}
                className="px-3 py-2 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors flex-shrink-0"
              >
                Remove key
              </button>
            )}
            {openaiRemoveKey && (
              <button
                onClick={() => setOpenaiRemoveKey(false)}
                className="px-3 py-2 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
              >
                Cancel
              </button>
            )}
          </div>
          {openaiRemoveKey && (
            <p className="text-xs text-[var(--error)] mt-1.5">
              Key will be removed when you save.
            </p>
          )}
          <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
            Keys are stored in your local database on this machine.
          </p>
        </div>

        <div className="space-y-2">
          <TestConnectionButton
            label="Test connection"
            state={openaiTest}
            onTest={() => runTest("openai", setOpenaiTest)}
          />
          <TestResult state={openaiTest} />
        </div>
      </section>

      {/* Gemini */}
      <section id="gemini" className="card-elevated p-5 space-y-4 scroll-mt-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[var(--well)] flex items-center justify-center border border-[var(--hairline)] flex-shrink-0">
            <Zap className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
          <h2 className="etched-label">Gemini</h2>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Model
          </label>
          <input
            type="text"
            value={geminiModel}
            onChange={(e) => setGeminiModel(e.target.value)}
            placeholder="gemini-2.0-flash"
            className="w-full px-3 py-2 input-base text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            API key
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={geminiKeyInput}
              onChange={(e) => {
                setGeminiKeyInput(e.target.value);
                if (geminiRemoveKey) setGeminiRemoveKey(false);
              }}
              placeholder={geminiRemoveKey ? "" : loaded?.geminiApiKey || "AIza..."}
              autoComplete="off"
              className="flex-1 px-3 py-2 input-base text-sm font-mono"
            />
            {loaded?.geminiApiKey && !geminiRemoveKey && (
              <button
                onClick={() => setGeminiRemoveKey(true)}
                className="px-3 py-2 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors flex-shrink-0"
              >
                Remove key
              </button>
            )}
            {geminiRemoveKey && (
              <button
                onClick={() => setGeminiRemoveKey(false)}
                className="px-3 py-2 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
              >
                Cancel
              </button>
            )}
          </div>
          {geminiRemoveKey && (
            <p className="text-xs text-[var(--error)] mt-1.5">
              Key will be removed when you save.
            </p>
          )}
          <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
            Keys are stored in your local database on this machine.
          </p>
        </div>

        <div className="space-y-2">
          <TestConnectionButton
            label="Test connection"
            state={geminiTest}
            onTest={() => runTest("gemini", setGeminiTest)}
          />
          <TestResult state={geminiTest} />
        </div>
      </section>

      {/* OpenAI-compatible */}
      <section id="openai-compatible" className="card-elevated p-5 space-y-4 scroll-mt-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-[var(--well)] flex items-center justify-center border border-[var(--hairline)] flex-shrink-0">
            <Plug className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
          <h2 className="etched-label">OpenAI-compatible</h2>
        </div>

        <p className="text-xs text-[var(--text-tertiary)]">
          Any OpenAI-compatible endpoint — Groq, vLLM, LM Studio, Ollama&apos;s OpenAI mode… Works
          with local servers too (vLLM, LM Studio); still listed as cloud here since it&apos;s
          reached over the network like the other providers.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Base URL
            </label>
            <input
              type="text"
              value={compatBaseUrl}
              onChange={(e) => setCompatBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className="w-full px-3 py-2 input-base text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Model
            </label>
            <input
              type="text"
              value={compatModel}
              onChange={(e) => setCompatModel(e.target.value)}
              placeholder="gemma3:4b"
              className="w-full px-3 py-2 input-base text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            API key <span className="text-[var(--text-tertiary)] normal-case">(optional — some local servers don&apos;t need one)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={compatKeyInput}
              onChange={(e) => {
                setCompatKeyInput(e.target.value);
                if (compatRemoveKey) setCompatRemoveKey(false);
              }}
              placeholder={compatRemoveKey ? "" : loaded?.compatApiKey || "leave blank if not required"}
              autoComplete="off"
              className="flex-1 px-3 py-2 input-base text-sm font-mono"
            />
            {loaded?.compatApiKey && !compatRemoveKey && (
              <button
                onClick={() => setCompatRemoveKey(true)}
                className="px-3 py-2 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors flex-shrink-0"
              >
                Remove key
              </button>
            )}
            {compatRemoveKey && (
              <button
                onClick={() => setCompatRemoveKey(false)}
                className="px-3 py-2 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
              >
                Cancel
              </button>
            )}
          </div>
          {compatRemoveKey && (
            <p className="text-xs text-[var(--error)] mt-1.5">
              Key will be removed when you save.
            </p>
          )}
          <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
            Keys are stored in your local database on this machine.
          </p>
        </div>

        <div className="space-y-2">
          <TestConnectionButton
            label="Test connection"
            state={compatTest}
            onTest={() => runTest("openai-compatible", setCompatTest)}
          />
          <TestResult state={compatTest} />
        </div>
      </section>

      {/* Save — sticky so a change made 2,000px up never hides its own
          commit button (critique 2026-08-18); the bar only reads as a bar
          when there is something to save. */}
      <div
        className={`sticky bottom-0 -mx-1 flex items-center gap-3 px-1 py-3 ${
          hasChanges
            ? "border-t border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--panel)_92%,transparent)] backdrop-blur-sm"
            : ""
        }`}
      >
        <button
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className="px-4 py-2 btn-primary text-sm disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save changes"}
        </button>
        {saveStatus === "saved" && (
          <span className="flex items-center gap-1.5 text-sm text-[var(--success)]">
            <Check className="w-4 h-4" /> Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="text-sm text-[var(--error)]">{saveError}</span>
        )}
      </div>
    </div>
  );
}
