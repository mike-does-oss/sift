"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Sparkles, Table2, FolderOpen, Save, Loader2, Anchor } from "lucide-react";
import {
  FieldConfiguration,
  ResultsDisplay,
  DocumentView,
  SaveToDatasetPanel,
  CompletionPopup,
  type DocumentViewHandle,
  type ResultsDisplayHandle,
  type CompletionPopupInfo,
} from "@/components";
import type { ExtractionField, ExtractionData, ExtractionResult, TemplateExample } from "@/types";
import type { ScaffoldResponse } from "@/lib/api";
import { PRESET_TEMPLATES } from "@/lib/presets";
import { webSiftApi, type ProviderInfo, type ProviderOverride, type ProviderId } from "@/lib/api";
import { useHosted } from "@/components/ProfileContext";
import { createPullProgressTracker } from "@/lib/pull-progress";
import { DEFAULT_FIELDS, isDefaultFieldState } from "@/lib/field-state";
import type { ModelRec } from "@/lib/model-recommend";
import type { Quotes } from "@/lib/highlight";

const DEFAULT_OLLAMA_MODEL = "gemma3:4b";
const GROUNDED_STORAGE_KEY = "sift-grounded";
const DOC_COLLAPSED_STORAGE_KEY = "sift-doc-collapsed";

type PullUiState =
  | { status: "idle" }
  | { status: "pulling"; percent: number | null; statusText: string }
  | { status: "error"; error: string };

interface Template {
  id: string;
  name: string;
  fields: ExtractionField[];
  prompt: string;
  extractMultiple: boolean;
  examples?: TemplateExample[];
}

interface DefaultSettings {
  provider: string;
  ollamaModel: string;
  anthropicModel: string;
  openaiModel: string;
  geminiModel: string;
  compatModel: string;
}

function modelForProvider(s: DefaultSettings): string {
  switch (s.provider) {
    case "anthropic":
      return s.anthropicModel;
    case "openai":
      return s.openaiModel;
    case "gemini":
      return s.geminiModel;
    case "openai-compatible":
      return s.compatModel;
    default:
      return s.ollamaModel;
  }
}

/** "<providerId>::<model>" — default mirrors saved settings, falling back to any other usable provider if the saved default isn't actually usable right now (e.g. no key configured, or the saved ollama model isn't installed). */
function defaultProviderKey(providers: ProviderInfo[], settings: DefaultSettings | null): string {
  const byId = (id: string) => providers.find((p) => p.id === id);

  if (settings) {
    const info = byId(settings.provider);
    if (info?.id === "ollama") {
      const preferred = settings.ollamaModel;
      const model = info.models.includes(preferred) ? preferred : info.models[0];
      if (model) return `ollama::${model}`;
    } else if (info?.configured) {
      const model = modelForProvider(settings) || info.models[0] || "";
      if (model) return `${info.id}::${model}`;
    }
  }

  const firstConfiguredCloud = providers.find((p) => p.id !== "ollama" && p.configured && p.models[0]);
  if (firstConfiguredCloud) return `${firstConfiguredCloud.id}::${firstConfiguredCloud.models[0]}`;

  const ollama = byId("ollama");
  if (ollama?.models[0]) return `ollama::${ollama.models[0]}`;

  return "";
}

export default function ExtractPage() {
  // §SaaS-1 T6: on hosted the provider/model pair is a billing decision made
  // server-side (resolveProvider's hosted branch) — the picker collapses to
  // an info label, no override is ever sent, and the Ollama onboarding
  // affordances never render. Local behavior is untouched.
  const hosted = useHosted();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extractionPrompt, setExtractionPrompt] = useState("");
  const [extractMultiple, setExtractMultiple] = useState(false);
  // Opt-in (§T2.5): quote-grounded extraction is a richer output shape that
  // smaller local models may follow less strictly, so it defaults off and is
  // remembered per-browser rather than per-request. Read from localStorage
  // in an effect (not lazy useState init) to avoid an SSR/hydration mismatch.
  const [groundedMode, setGroundedMode] = useState(false);
  // Document pane collapse (playbook §13 task): default expanded, synced
  // from localStorage post-mount — same pattern as groundedMode above, so
  // the server-rendered (always-expanded) markup never mismatches on hydrate.
  const [docCollapsed, setDocCollapsed] = useState(false);
  const [fields, setFields] = useState<ExtractionField[]>(DEFAULT_FIELDS);
  const [results, setResults] = useState<ExtractionData | null>(null);
  // Mirrors ResultsDisplay's internal "edited" working copy (ALL rows, not
  // just its currently visible page) for the sibling "Save to dataset" card
  // below the results table (§13, "separate save-to-dataset from results").
  // Reset here (render-time, keyed on `results`' own reference change) in
  // lockstep with ResultsDisplay's own reset of its `edited` state on a new
  // extraction; kept live thereafter via `onEditedRowsChange`, called from
  // ResultsDisplay's edit/reset event handlers.
  const [datasetRows, setDatasetRows] = useState<ExtractionResult[]>([]);
  const [prevResultsForDataset, setPrevResultsForDataset] = useState<ExtractionData | null>(results);
  if (results !== prevResultsForDataset) {
    setPrevResultsForDataset(results);
    setDatasetRows(Array.isArray(results) ? results : results ? [results] : []);
  }
  const [extractedText, setExtractedText] = useState<string | undefined>(undefined);
  const [quotes, setQuotes] = useState<Quotes | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedWith, setExtractedWith] = useState<{ provider: string; model: string } | null>(null);
  // Task-done-popup brief: a fresh object on every successful extraction
  // (re-arming CompletionPopup's auto-dismiss timer even for a back-to-back
  // extraction with identical field/row counts); `null` renders nothing.
  const [completion, setCompletion] = useState<CompletionPopupInfo | null>(null);

  // Prompt scaffolding (§T2.6) — "Build fields from description", visible only
  // while grounded mode is on. `pendingScaffold` holds a scaffolded result
  // awaiting the inline "Replace current fields?" confirm (only shown when
  // the current fields aren't still the untouched single starter field).
  const [isScaffolding, setIsScaffolding] = useState(false);
  const [scaffoldError, setScaffoldError] = useState<string | null>(null);
  const [pendingScaffold, setPendingScaffold] = useState<{
    fields: ExtractionField[];
    prompt: string;
    extractMultiple: boolean;
  } | null>(null);

  const documentViewRef = useRef<DocumentViewHandle>(null);
  const resultsDisplayRef = useRef<ResultsDisplayHandle>(null);
  // Two-way hover linking (per-field color-coded highlights task): which
  // field is currently hovered, in either pane — lifted here (not local to
  // either component) because a hover in DocumentView needs to tint
  // ResultsDisplay's column and vice versa.
  const [hoveredField, setHoveredField] = useState<string | null>(null);

  // Per-request provider/model picker (playbook §13 action bar).
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providersFailed, setProvidersFailed] = useState(false);
  const [providerKey, setProviderKey] = useState("");
  // Hardware-sized suggestion for the "no local models" affordance below —
  // distinct from the per-provider model picker above.
  const [systemRec, setSystemRec] = useState<ModelRec | null>(null);
  const [pullState, setPullState] = useState<PullUiState>({ status: "idle" });
  const pullAbortRef = useRef<AbortController | null>(null);
  // In-flight extraction — lets the loading card's Cancel abort the fetch.
  const extractAbortRef = useRef<AbortController | null>(null);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  // Confirm-before-clobber (same bar as the scaffold flow): a picked template
  // waits here when the current fields aren't the untouched starter field,
  // instead of silently replacing whatever the user has built up.
  const [pendingTemplate, setPendingTemplate] = useState<{
    id: string;
    name: string;
    fields: ExtractionField[];
    prompt: string;
    extractMultiple: boolean;
  } | null>(null);
  const [isNamingTemplate, setIsNamingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const fetchTemplates = useCallback(async () => {
    try {
      const response = await fetch("/api/templates");
      if (!response.ok) return;
      const data = await response.json();
      setTemplates(data.templates ?? []);
    } catch {
      // template list is a convenience — silently ignore fetch failures
    }
  }, []);

  useEffect(() => {
    (async () => {
      await fetchTemplates();
    })();
  }, [fetchTemplates]);

  useEffect(() => {
    // One-time sync from localStorage (external system) on mount, after the
    // server-rendered (always-off) markup has hydrated — avoids an
    // SSR/client markup mismatch that a render-time read would cause (same
    // pattern as Sidebar's theme sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroundedMode(window.localStorage.getItem(GROUNDED_STORAGE_KEY) === "true");
    setDocCollapsed(window.localStorage.getItem(DOC_COLLAPSED_STORAGE_KEY) === "true");
  }, []);

  const handleToggleGrounded = (checked: boolean) => {
    setGroundedMode(checked);
    window.localStorage.setItem(GROUNDED_STORAGE_KEY, checked ? "true" : "false");
  };

  const handleSetDocCollapsed = (collapsed: boolean) => {
    setDocCollapsed(collapsed);
    window.localStorage.setItem(DOC_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  };

  useEffect(() => {
    (async () => {
      try {
        // Hosted: the single anthropic entry (plan/BYO model) backs the info
        // label — no settings read, no picker default to compute.
        if (hosted) {
          setProviders(await webSiftApi.listProviders());
          return;
        }
        const [providerList, settingsBody] = await Promise.all([
          webSiftApi.listProviders(),
          fetch("/api/settings")
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
        const loadedSettings = (settingsBody?.settings as DefaultSettings) ?? null;
        setProviders(providerList);
        setProviderKey(defaultProviderKey(providerList, loadedSettings));
      } catch {
        // Provider list is best-effort: the picker stays empty, but extraction
        // must still work — canExtract below skips the provider requirement
        // in this case and the request goes out with no override, so the
        // server picks its own (settings-driven) default.
        setProvidersFailed(true);
      } finally {
        setProvidersLoaded(true);
      }
    })();
  }, [hosted]);

  useEffect(() => {
    if (hosted) return; // /api/system doesn't exist on hosted (no Ollama downloads)
    (async () => {
      try {
        const info = await webSiftApi.getSystemInfo();
        setSystemRec(info.recommendations.find((r) => r.recommended) ?? null);
      } catch {
        // best-effort hardware hint — the affordance below falls back to
        // DEFAULT_OLLAMA_MODEL when this hasn't loaded (or failed).
      }
    })();
  }, [hosted]);

  const [selProviderId, selModel] = useMemo(() => {
    const [id, model] = providerKey.split("::");
    return [id ?? "", model ?? ""];
  }, [providerKey]);

  // The action bar's current provider/model selection, in the shape both
  // `extract` and `scaffold` accept as a per-request override — built once
  // so both call sites dispatch through the identical resolution (§S3: the
  // "Build fields from description" action used to silently ignore this and
  // always run against the configured default provider instead of whatever
  // the picker shows).
  // On hosted there is nothing to override — the server resolves the model
  // from the plan/BYO key and discards request overrides anyway (defense in
  // depth at both layers).
  const providerOverride: ProviderOverride | undefined = useMemo(
    () => (!hosted && selProviderId ? { provider: selProviderId as ProviderId, model: selModel || undefined } : undefined),
    [hosted, selProviderId, selModel]
  );

  // §T3 — examples ride along silently with whatever saved template is
  // currently loaded (no workspace editor for them this pass; presets never
  // carry examples). Derived straight from `templates`/`selectedTemplateId`
  // rather than copied into its own state, so it can never drift out of sync
  // with the picker (e.g. after switching templates).
  const selectedTemplateExamples = templates.find((t) => t.id === selectedTemplateId)?.examples;

  const selectedProviderInfo = providers.find((p) => p.id === selProviderId);
  const privacyBadge = selectedProviderInfo
    ? selectedProviderInfo.privacy === "local"
      ? { emoji: "🔒", text: `Local · ${selModel || "no model"}` }
      : { emoji: "☁", text: `Cloud · ${selectedProviderInfo.label} ${selModel}` }
    : null;

  const localProvider = providers.find((p) => p.id === "ollama");
  const cloudProviders = providers.filter((p) => p.id !== "ollama");
  // Ollama reachable but nothing installed yet (post-onboarding state) —
  // `note` is only set when the provider is unreachable, so its absence
  // here means the "no models" affordance below applies.
  const showOllamaPullAffordance =
    !hosted && providersLoaded && !!localProvider && localProvider.models.length === 0 && !localProvider.note;

  // Hosted info label replacing the picker: the one model this account's
  // extractions run on right now (plan tier, or opus with an active BYO key)
  // as reported by /api/providers' anthropic-only hosted response.
  const hostedModel = hosted ? (providers.find((p) => p.id === "anthropic")?.models[0] ?? "") : "";

  // Aborting on unmount stops the in-flight fetch/stream read if the user
  // navigates away mid-download. Ollama caches layers it has already
  // fetched, so a re-click resumes rather than restarting from zero.
  useEffect(() => {
    return () => {
      pullAbortRef.current?.abort();
      extractAbortRef.current?.abort();
    };
  }, []);

  const handlePullOllamaModel = async () => {
    if (pullState.status === "pulling") return;
    const model = systemRec?.model || DEFAULT_OLLAMA_MODEL;

    const controller = new AbortController();
    pullAbortRef.current = controller;
    const tracker = createPullProgressTracker();
    setPullState({ status: "pulling", percent: null, statusText: "Starting…" });

    try {
      await webSiftApi.pullModel(
        model,
        (progress) => {
          const { status, percent } = tracker.update(progress);
          setPullState({ status: "pulling", percent, statusText: status });
        },
        controller.signal
      );
      setPullState({ status: "idle" });
      // Refetch providers so the newly installed model populates the picker
      // — only claim the selection if nothing usable was selected before,
      // respecting whatever the user already had picked.
      const refreshed = await webSiftApi.listProviders();
      setProviders(refreshed);
      setProviderKey((prev) => prev || defaultProviderKey(refreshed, null));
    } catch (err) {
      if (controller.signal.aborted) return; // deliberate navigation-away abort, not a real failure
      setPullState({ status: "error", error: err instanceof Error ? err.message : "Download failed." });
    }
  };

  const applyTemplate = (config: NonNullable<typeof pendingTemplate>) => {
    setFields(config.fields);
    setExtractionPrompt(config.prompt);
    setExtractMultiple(config.extractMultiple);
    setSelectedTemplateId(config.id);
    setPendingTemplate(null);
    setPendingScaffold(null);
  };

  const handleLoadTemplate = (templateId: string) => {
    if (!templateId) {
      setSelectedTemplateId("");
      setPendingTemplate(null);
      return;
    }

    let config: NonNullable<typeof pendingTemplate> | null = null;
    if (templateId.startsWith("preset:")) {
      const presetKey = templateId.slice("preset:".length);
      const preset = PRESET_TEMPLATES.find((p) => p.key === presetKey);
      if (!preset) return;
      config = {
        id: templateId,
        name: preset.name,
        // Deep-copy so in-editor edits never mutate the module-level constant.
        fields: preset.fields.map((f) => ({ ...f })),
        prompt: preset.prompt,
        extractMultiple: preset.extractMultiple,
      };
    } else {
      const template = templates.find((t) => t.id === templateId);
      if (!template) return;
      config = {
        id: templateId,
        name: template.name,
        fields: template.fields,
        prompt: template.prompt,
        extractMultiple: template.extractMultiple,
      };
    }

    // Same bar as the scaffold flow (§T2.6): only the untouched starter
    // field may be replaced silently — anything else asks first. The select
    // stays on the previous choice until the user confirms.
    if (isDefaultFieldState(fields)) {
      applyTemplate(config);
    } else {
      setPendingTemplate(config);
    }
  };

  const handleSaveTemplate = async () => {
    const validFields = fields.filter((f) => f.name.trim() !== "");
    if (!templateName.trim() || validFields.length === 0) return;

    setSaveStatus("saving");
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          fields: validFields,
          prompt: extractionPrompt,
          extractMultiple,
        }),
      });
      if (!response.ok) throw new Error("Failed to save template");
      const data = await response.json();
      setTemplates((prev) => [data.template, ...prev]);
      setSelectedTemplateId(data.template.id);
      setSaveStatus("saved");
      setIsNamingTemplate(false);
      setTemplateName("");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    }
  };

  const applyScaffold = (scaffolded: { fields: ExtractionField[]; prompt: string; extractMultiple: boolean }) => {
    setFields(scaffolded.fields);
    setExtractionPrompt(scaffolded.prompt);
    setExtractMultiple(scaffolded.extractMultiple);
    setPendingScaffold(null);
    // A scaffold replacing the fields settles any still-open template confirm.
    setPendingTemplate(null);
  };

  const handleBuildFromDescription = async () => {
    if (!extractionPrompt.trim() || isScaffolding) return;

    setIsScaffolding(true);
    setScaffoldError(null);
    try {
      const result: ScaffoldResponse = await webSiftApi.scaffold(extractionPrompt.trim(), providerOverride);
      if (result.error || !result.fields) {
        setScaffoldError(result.error || "Scaffolding failed");
        return;
      }
      const scaffolded = { fields: result.fields, prompt: result.prompt ?? "", extractMultiple: result.extractMultiple ?? false };
      if (isDefaultFieldState(fields)) {
        applyScaffold(scaffolded);
      } else {
        setPendingScaffold(scaffolded);
      }
    } catch (err) {
      setScaffoldError(err instanceof Error ? err.message : "Scaffolding failed");
    } finally {
      setIsScaffolding(false);
    }
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setResults(null);
    setExtractedText(undefined);
    setQuotes(undefined);
    setError(null);
    setExtractedWith(null);
    setCompletion(null);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setResults(null);
    setExtractedText(undefined);
    setQuotes(undefined);
    setError(null);
    setExtractedWith(null);
    setCompletion(null);
  };

  const handleExtract = async () => {
    if (!selectedFile) return;

    const validFields = fields.filter((f) => f.name.trim() !== "");
    if (validFields.length === 0) {
      setError("Please add at least one field with a name");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);
    setExtractedText(undefined);
    setQuotes(undefined);
    setExtractedWith(null);
    setCompletion(null);

    const controller = new AbortController();
    extractAbortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("fields", JSON.stringify(validFields));
      formData.append("prompt", extractionPrompt);
      formData.append("extractMultiple", extractMultiple.toString());
      if (groundedMode) formData.append("grounded", "true");
      if (selectedTemplateExamples && selectedTemplateExamples.length > 0) {
        formData.append("examples", JSON.stringify(selectedTemplateExamples));
      }
      if (providerOverride) {
        formData.append("provider", providerOverride.provider);
        if (providerOverride.model) formData.append("model", providerOverride.model);
      }

      const data = await webSiftApi.extract(formData, controller.signal);

      if (!data.success) {
        setError(data.error || "Extraction failed");
      } else {
        setResults(data.data ?? null);
        setExtractedText(data.text);
        setQuotes(data.quotes);
        if (data.provider && data.model) {
          setExtractedWith({ provider: data.provider, model: data.model });
        }
        // Auto-switch to the extracted-text view so highlights appear
        // immediately (task-done-popup brief §1) — only when there's
        // something to switch to; doesn't force-expand a collapsed pane.
        if (data.text) {
          documentViewRef.current?.showExtractedView();
        }
        setCompletion({
          fieldsCount: validFields.length,
          rowCount: Array.isArray(data.data) ? data.data.length : data.data ? 1 : 0,
          isMulti: extractMultiple,
          providerLabel: data.provider
            ? (providers.find((p) => p.id === data.provider)?.label ?? data.provider)
            : "",
          model: data.model ?? "",
        });
      }
    } catch (err) {
      // A deliberate Cancel is a quiet reset back to the ready state — the
      // user asked to stop, so there's nothing to report as an error.
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelExtraction = () => {
    extractAbortRef.current?.abort();
  };

  const handleJumpToValue = (fieldName: string, rowIndex: number) => {
    documentViewRef.current?.scrollToMark(fieldName, rowIndex);
  };

  /** Reverse of handleJumpToValue — a document mark was clicked, so flash+scroll the matching results cell. */
  const handleMarkClick = (fieldName: string, rowIndex: number) => {
    resultsDisplayRef.current?.flashCell(fieldName, rowIndex);
  };

  // Same filtered, ordered field list handed to both panes so a field's
  // color-coded mark and its results column always agree on which index
  // (hue) it gets — see fieldColors.ts.
  const activeFields = useMemo(() => fields.filter((f) => f.name.trim() !== ""), [fields]);

  const canExtract =
    Boolean(selectedFile) &&
    fields.some((f) => f.name.trim() !== "") &&
    // Hosted sends no override at all — the server picks the plan/BYO model.
    // If the provider list failed to load, fall back to a plain (no-override)
    // extraction request — the server still applies its own configured
    // default. Don't hard-block the core workflow on a transient fetch failure.
    (hosted || providersFailed || (Boolean(selProviderId) && (selProviderId !== "ollama" || Boolean(selModel))));

  const extractedWithLabel = extractedWith
    ? (providers.find((p) => p.id === extractedWith.provider)?.label ?? extractedWith.provider)
    : null;

  // Collapsing an empty pane is meaningless (brief §1): only shrink the
  // left pane / grow the right one once a document is actually loaded, even
  // if a collapsed preference is already persisted from a previous session.
  const leftPaneCollapsed = docCollapsed && Boolean(selectedFile);

  return (
    <div className="lg:flex lg:h-screen lg:flex-col">
      {/* Action bar — provider/model picker, privacy badge, Run extraction */}
      <div className="lg:flex-shrink-0 sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]/80 backdrop-blur-sm">
        {hosted ? (
          // No picker on hosted: the model is a plan decision, shown as info.
          <div
            className="data flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--accent-tint)] text-xs font-medium text-[var(--accent)]"
            title={hostedModel ? `Claude · ${hostedModel}` : "Claude"}
          >
            <span aria-hidden="true" className="not-italic">
              ☁
            </span>
            <span className="truncate max-w-[240px]">
              {hostedModel ? `Claude · ${hostedModel}` : "Claude"}
            </span>
          </div>
        ) : (
          <select
            value={providerKey}
            onChange={(e) => setProviderKey(e.target.value)}
            className="px-3 py-2 rounded-lg input-base text-sm min-w-[220px]"
            aria-label="Extraction provider and model"
          >
            {!providersLoaded && <option value="">Loading providers…</option>}
            {providersLoaded && !providerKey && <option value="">Select a provider…</option>}
            <optgroup label="Local">
              {localProvider && localProvider.models.length > 0 ? (
                localProvider.models.map((model) => (
                  <option key={model} value={`ollama::${model}`}>
                    Ollama · {model}
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  {localProvider?.note ?? "No local models installed"}
                </option>
              )}
            </optgroup>
            <optgroup label="Cloud">
              {cloudProviders.map((provider) => {
                const model = provider.models[0] ?? "";
                return (
                  <option key={provider.id} value={`${provider.id}::${model}`} disabled={!provider.configured}>
                    {provider.configured ? `${provider.label} · ${model}` : `${provider.label} — configure in Settings`}
                  </option>
                );
              })}
            </optgroup>
          </select>
        )}

        {!hosted && providersFailed && (
          <p className="text-xs text-[var(--text-tertiary)]">Couldn&apos;t load providers — using your saved settings</p>
        )}

        {showOllamaPullAffordance && (
          <div className="basis-full flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-tertiary)]">
              No local models — Download {systemRec?.model ?? DEFAULT_OLLAMA_MODEL}
              {systemRec ? ` (${systemRec.downloadSize})` : ""}
              {systemRec ? ` · ${systemRec.reason}` : ""}
            </span>
            <button
              onClick={handlePullOllamaModel}
              disabled={pullState.status === "pulling"}
              className="px-2.5 py-1 rounded-lg border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-50 flex-shrink-0"
            >
              {pullState.status === "pulling" ? "Downloading…" : "Download"}
            </button>
            {pullState.status === "pulling" && (
              <>
                <div className="w-24 h-1 rounded-full bg-[var(--surface-overlay)] overflow-hidden">
                  <div
                    className={`h-full bg-[var(--accent)] transition-all ${
                      pullState.percent === null ? "w-1/3 animate-pulse" : ""
                    }`}
                    style={pullState.percent !== null ? { width: `${pullState.percent}%` } : undefined}
                  />
                </div>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {pullState.statusText}
                  {pullState.percent !== null ? ` · ${pullState.percent}%` : ""}
                </span>
              </>
            )}
            {pullState.status === "error" && <span className="text-xs text-[var(--error)]">{pullState.error}</span>}
            <Link
              href="/dashboard/settings"
              className="text-xs text-[var(--accent)] hover:underline flex-shrink-0"
            >
              More options in Settings
            </Link>
          </div>
        )}

        {privacyBadge && (
          <div
            className="data flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--accent-tint)] text-xs font-medium text-[var(--accent)]"
            title={privacyBadge.text}
          >
            <span aria-hidden="true" className="not-italic">
              {privacyBadge.emoji}
            </span>
            <span className="truncate max-w-[240px]">{privacyBadge.text}</span>
          </div>
        )}

        <div className="flex-1" />

        <motion.button
          whileHover={canExtract && !isLoading ? { scale: 1.02 } : {}}
          whileTap={canExtract && !isLoading ? { scale: 0.98 } : {}}
          onClick={handleExtract}
          disabled={!canExtract || isLoading}
          className="px-5 py-2.5 rounded-lg btn-primary text-sm flex items-center gap-2 flex-shrink-0"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Extracting…</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Run extraction</span>
            </>
          )}
        </motion.button>
      </div>

      {/* Two-pane workspace: document left, fields + results right */}
      <div className="lg:flex-1 lg:flex lg:min-h-0">
        <div
          className={`${
            leftPaneCollapsed ? "lg:w-11" : "lg:w-1/2"
          } lg:flex-shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border-subtle)] bg-[var(--surface-inset)] lg:h-full lg:overflow-y-auto transition-[width] duration-200`}
        >
          <div className="h-[70vh] lg:h-full">
            <DocumentView
              ref={documentViewRef}
              file={selectedFile}
              onFileSelect={handleFileSelect}
              onClear={handleClear}
              results={results}
              extractedText={extractedText}
              quotes={quotes}
              fields={activeFields}
              hoveredField={hoveredField}
              onHoverField={setHoveredField}
              onMarkClick={handleMarkClick}
              collapsed={docCollapsed}
              onCollapsedChange={handleSetDocCollapsed}
            />
          </div>
        </div>

        <div className={`${leftPaneCollapsed ? "lg:flex-1" : "lg:w-1/2"} lg:h-full lg:overflow-y-auto`}>
          <div className="p-6 space-y-6">
            {/* Templates */}
            <section>
              <div className="flex items-center gap-3 mb-4">
                <FolderOpen className="w-4 h-4 text-[var(--text-tertiary)]" />
                <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                  Templates
                </h2>
              </div>
              <div className="card-elevated rounded-xl p-4 flex flex-wrap items-center gap-3">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleLoadTemplate(e.target.value)}
                  className="flex-1 min-w-[160px] px-3 py-2 rounded-lg input-base text-sm"
                  aria-label="Load a template"
                >
                  <option value="">Load a template…</option>
                  {templates.length > 0 && (
                    <optgroup label="Your templates">
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Examples">
                    {PRESET_TEMPLATES.map((preset) => (
                      <option key={preset.key} value={`preset:${preset.key}`}>
                        {preset.name}
                      </option>
                    ))}
                  </optgroup>
                </select>

                {isNamingTemplate ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveTemplate();
                        if (e.key === "Escape") {
                          setIsNamingTemplate(false);
                          setTemplateName("");
                        }
                      }}
                      placeholder="Template name"
                      className="w-40 px-3 py-2 rounded-lg input-base text-sm"
                    />
                    <button
                      onClick={handleSaveTemplate}
                      disabled={!templateName.trim() || saveStatus === "saving"}
                      className="px-3 py-2 rounded-lg btn-primary text-xs disabled:opacity-50"
                    >
                      {saveStatus === "saving" ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setIsNamingTemplate(false);
                        setTemplateName("");
                      }}
                      className="px-2 py-2 rounded-lg text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsNamingTemplate(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] text-xs font-medium hover:border-[var(--accent-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save as template
                  </button>
                )}

                {saveStatus === "saved" && <span className="text-xs text-[var(--success)]">Saved</span>}
                {saveStatus === "error" && <span className="text-xs text-[var(--error)]">Couldn&apos;t save template</span>}

                {/* Same inline confirm the scaffold flow uses — loading a
                    template must not silently clobber edited fields. */}
                {pendingTemplate && (
                  <div className="basis-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-muted)]">
                    <span className="text-xs text-[var(--text-secondary)] flex-1">
                      Replace current fields with &ldquo;{pendingTemplate.name}&rdquo;?
                    </span>
                    <button
                      onClick={() => applyTemplate(pendingTemplate)}
                      className="px-2 py-1 rounded-md text-xs font-medium text-[var(--accent)] hover:bg-[var(--surface-elevated)] transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setPendingTemplate(null)}
                      className="px-2 py-1 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              {selectedTemplateExamples && selectedTemplateExamples.length > 0 && (
                <p className="text-xs text-[var(--text-tertiary)] mt-2 px-1">
                  {selectedTemplateExamples.length} example{selectedTemplateExamples.length === 1 ? "" : "s"} guiding
                  this template
                </p>
              )}
            </section>

            {/* Field configuration */}
            <section>
              <div className="flex items-center gap-3 mb-4">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-xs font-semibold">
                  1
                </span>
                <h2 className="font-display text-xl text-[var(--text-primary)]">Define Extraction</h2>
              </div>
              <div className="card-elevated rounded-xl p-5">
                <FieldConfiguration
                  fields={fields}
                  onFieldsChange={setFields}
                  extractionPrompt={extractionPrompt}
                  onPromptChange={setExtractionPrompt}
                  scaffold={{
                    visible: groundedMode,
                    isRunning: isScaffolding,
                    error: scaffoldError,
                    confirming: pendingScaffold !== null,
                    onBuild: handleBuildFromDescription,
                    onConfirmReplace: () => pendingScaffold && applyScaffold(pendingScaffold),
                    onCancelConfirm: () => setPendingScaffold(null),
                  }}
                />

                <div className="mt-5 pt-5 border-t border-[var(--border-subtle)]">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:border-[var(--accent-muted)] transition-colors">
                        <Table2 className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent)] transition-colors" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">Extract multiple rows</p>
                        <p className="text-xs text-[var(--text-tertiary)]">For tables, lists, or repeated data</p>
                      </div>
                    </div>
                    <div
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        extractMultiple ? "bg-[var(--accent)]" : "bg-[var(--surface-overlay)]"
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                          extractMultiple ? "left-6" : "left-1"
                        }`}
                      />
                      <input
                        type="checkbox"
                        checked={extractMultiple}
                        onChange={(e) => setExtractMultiple(e.target.checked)}
                        className="sr-only"
                      />
                    </div>
                  </label>
                </div>

                <div className="mt-5 pt-5 border-t border-[var(--border-subtle)]">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:border-[var(--accent-muted)] transition-colors">
                        <Anchor className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent)] transition-colors" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">Grounded mode</p>
                        <p className="text-xs text-[var(--text-tertiary)]">
                          Anchor every value to an exact source quote. Shows you exactly where each value came from.
                        </p>
                      </div>
                    </div>
                    <div
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                        groundedMode ? "bg-[var(--accent)]" : "bg-[var(--surface-overlay)]"
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                          groundedMode ? "left-6" : "left-1"
                        }`}
                      />
                      <input
                        type="checkbox"
                        checked={groundedMode}
                        onChange={(e) => handleToggleGrounded(e.target.checked)}
                        className="sr-only"
                      />
                    </div>
                  </label>
                </div>
              </div>
            </section>

            {/* Results */}
            <AnimatePresence mode="wait">
              {(results || isLoading || error) && (
                <motion.section
                  key="results"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--success-subtle)] text-[var(--success)] text-xs font-semibold">
                      2
                    </span>
                    <h2 className="font-display text-xl text-[var(--text-primary)]">Results</h2>
                  </div>

                  {extractedWith && !isLoading && !error && (
                    <p className="text-xs text-[var(--text-tertiary)] mb-3">
                      Extracted with {extractedWithLabel} · {extractedWith.model}
                    </p>
                  )}

                  <ResultsDisplay
                    ref={resultsDisplayRef}
                    results={results}
                    fields={activeFields}
                    isLoading={isLoading}
                    error={error}
                    onJumpToValue={extractedText ? handleJumpToValue : undefined}
                    extractedText={extractedText}
                    quotes={quotes}
                    hoveredField={hoveredField}
                    onHoverField={setHoveredField}
                    onEditedRowsChange={setDatasetRows}
                    onCancelExtraction={handleCancelExtraction}
                    loadingModel={hosted ? hostedModel : selModel}
                    providerModelLabel={
                      extractedWith && !isLoading && !error
                        ? `Extracted with ${extractedWithLabel} · ${extractedWith.model}`
                        : undefined
                    }
                  />
                </motion.section>
              )}
            </AnimatePresence>

            {/* Save to dataset — its own sibling card below results (§13,
                "separate save-to-dataset from results"): same visibility
                condition results itself uses (there's something to save). */}
            {results && !isLoading && !error && datasetRows.length > 0 && (
              <section>
                <h2 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                  Save to dataset
                </h2>
                <div className="card-elevated rounded-xl p-4">
                  <SaveToDatasetPanel fieldKeys={activeFields.map((f) => f.name)} rows={datasetRows} />
                </div>
              </section>
            )}

            {!results && !isLoading && !error && (
              <p className="text-xs text-[var(--text-tertiary)] px-1">
                Define your fields, then run extraction to see results here.
              </p>
            )}
          </div>
        </div>
      </div>

      <CompletionPopup info={completion} onDismiss={() => setCompletion(null)} />
    </div>
  );
}
