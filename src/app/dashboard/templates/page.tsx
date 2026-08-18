"use client";

import { useCallback, useEffect, useState } from "react";
import { FileJson, Plus, Pencil, Trash2, Table2, Sparkles, Check, Braces, X } from "lucide-react";
import { FieldConfiguration } from "@/components";
import type { ExtractionField, TemplateExample } from "@/types";
import { PRESET_TEMPLATES } from "@/lib/presets";

interface Template {
  id: string;
  name: string;
  fields: ExtractionField[];
  prompt: string;
  extractMultiple: boolean;
  examples?: TemplateExample[];
}

const EMPTY_FIELD = (): ExtractionField => ({ id: `field-${Date.now()}`, name: "", type: "text" });

const MAX_EXAMPLES = 5;

/** Which half of the §13 segmented pill tab bar is showing (founder feedback: presets and saved templates were mixed into one "cards and boxes" list — split them so "add" and "manage" each get their own tab). */
type Tab = "yours" | "examples";

/** A single example entry mid-edit — `text` is the raw JSON the user is typing (the `output` object, unwrapped); `error` is set on blur (or at save time) when it doesn't parse to a plain object, and cleared as soon as the user edits again. */
interface ExampleDraft {
  text: string;
  error: string | null;
}

function draftFromExample(e: TemplateExample): ExampleDraft {
  return { text: JSON.stringify(e.output, null, 2), error: null };
}

/** Parses a draft's raw text into a `TemplateExample["output"]` — must be a JSON object, not an array/string/number/null (mirrors `validateExamples`, src/lib/template-examples.ts). */
function parseExampleOutput(raw: string): { ok: true; output: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: 'Must be a JSON object, e.g. {"vendor": "ACME"}' };
  }
  return { ok: true, output: parsed as Record<string, unknown> };
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // "new" or a template id
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [extractMultiple, setExtractMultiple] = useState(false);
  const [fields, setFields] = useState<ExtractionField[]>([EMPTY_FIELD()]);
  const [exampleDrafts, setExampleDrafts] = useState<ExampleDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addingPresetKey, setAddingPresetKey] = useState<string | null>(null);
  const [addedPresetKey, setAddedPresetKey] = useState<string | null>(null);
  // Default: "Your templates" once there's something to show, "Examples" for
  // a first-run/empty account. `load()` only runs once (on mount), so this
  // is set exactly once from the fetched list and never fights a tab switch
  // the user makes afterward.
  const [activeTab, setActiveTab] = useState<Tab>("examples");
  // The just-added-from-preset row to flash on the "Your templates" tab —
  // cleared after the animation window so it doesn't replay on re-render.
  const [flashId, setFlashId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const list: Template[] = (await res.json()).templates ?? [];
        setTemplates(list);
        setActiveTab(list.length > 0 ? "yours" : "examples");
      }
    } catch {
      // transient network failure — the page renders with whatever loaded
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const startCreate = () => {
    setActiveTab("yours");
    setEditingId("new");
    setName("");
    setPrompt("");
    setExtractMultiple(false);
    setFields([EMPTY_FIELD()]);
    setExampleDrafts([]);
    setError(null);
  };

  const startEdit = (t: Template) => {
    setActiveTab("yours");
    setEditingId(t.id);
    setName(t.name);
    setPrompt(t.prompt);
    setExtractMultiple(t.extractMultiple);
    setFields(t.fields);
    setExampleDrafts((t.examples ?? []).map(draftFromExample));
    setError(null);
  };

  const cancelEdit = () => setEditingId(null);

  const addExampleDraft = () => {
    if (exampleDrafts.length >= MAX_EXAMPLES) return;
    setExampleDrafts((prev) => [...prev, { text: "", error: null }]);
  };

  const removeExampleDraft = (index: number) => {
    setExampleDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateExampleDraftText = (index: number, text: string) => {
    setExampleDrafts((prev) => prev.map((d, i) => (i === index ? { text, error: null } : d)));
  };

  const validateExampleDraft = (index: number) => {
    setExampleDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== index || d.text.trim() === "") return d;
        const result = parseExampleOutput(d.text.trim());
        return { ...d, error: result.ok ? null : result.error };
      })
    );
  };

  const handleSave = async () => {
    const validFields = fields.filter((f) => f.name.trim() !== "");
    if (!name.trim() || validFields.length === 0) {
      setError("Name and at least one field are required");
      return;
    }

    // Re-validate every non-empty draft at save time too (not just on blur —
    // the field the user was last typing in may never have blurred). An
    // invalid example blocks the save so nothing is silently dropped.
    const examples: TemplateExample[] = [];
    let anyInvalid = false;
    const revalidated = exampleDrafts.map((d) => {
      const trimmed = d.text.trim();
      if (trimmed === "") return d;
      const result = parseExampleOutput(trimmed);
      if (result.ok) {
        examples.push({ output: result.output });
        return { ...d, error: null };
      }
      anyInvalid = true;
      return { ...d, error: result.error };
    });
    if (anyInvalid) {
      setExampleDrafts(revalidated);
      setError("Fix or clear the invalid example(s) before saving.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const isNew = editingId === "new";
      const url = isNew ? "/api/templates" : `/api/templates/${editingId}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), fields: validFields, prompt, extractMultiple, examples }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save template");
        return;
      }
      if (isNew) {
        setTemplates((prev) => [data.template, ...prev]);
      } else {
        setTemplates((prev) => prev.map((t) => (t.id === data.template.id ? data.template : t)));
      }
      setEditingId(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDeleteError(data?.error || "Failed to delete template");
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setConfirmDeleteId(null);
    setDeleteError(null);
  };

  const handleAddPreset = async (preset: (typeof PRESET_TEMPLATES)[number]) => {
    setAddingPresetKey(preset.key);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          // Deep-copy so nothing downstream can mutate the module constant.
          fields: preset.fields.map((f) => ({ ...f })),
          prompt: preset.prompt,
          extractMultiple: preset.extractMultiple,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setTemplates((prev) => [data.template, ...prev]);
      setAddedPresetKey(preset.key);
      setTimeout(() => setAddedPresetKey((k) => (k === preset.key ? null : k)), 2000);
      // Switch to "Your templates" so the add's result is visible, and flash
      // the new row (reuses the sift-mark-flash convention: JS always
      // triggers it, the CSS keyframe is what prefers-reduced-motion drops —
      // see .row-flash in globals.css).
      setActiveTab("yours");
      setFlashId(data.template.id);
      setTimeout(() => setFlashId((id) => (id === data.template.id ? null : id)), 1300);
    } finally {
      setAddingPresetKey(null);
    }
  };

  const isEditingForm = editingId !== null;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-[var(--text-primary)] flex items-center gap-3">
            <FileJson className="w-6 h-6 text-[var(--accent)]" />
            Templates
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Reusable field definitions for extractions, batches, and schedules.
          </p>
        </div>
        {activeTab === "yours" && !isEditingForm && (
          <button
            onClick={startCreate}
            className="flex items-center gap-2 px-3 py-2 rounded-lg btn-primary text-sm"
          >
            <Plus className="w-4 h-4" />
            New template
          </button>
        )}
      </div>

      {/* §13 segmented pill tab bar — same visual language as DocumentView's
          Document/Extracted-text toggle. Founder feedback: presets ("cards
          and boxes") and saved templates were mixed into one list; splitting
          "add from an example" from "manage what I've saved" into tabs makes
          the two actions legible on their own. */}
      <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-0.5 text-sm font-medium w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("yours")}
          aria-pressed={activeTab === "yours"}
          className={`px-3.5 py-1.5 rounded-md transition-colors ${
            activeTab === "yours"
              ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          Your templates
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("examples")}
          aria-pressed={activeTab === "examples"}
          className={`px-3.5 py-1.5 rounded-md transition-colors ${
            activeTab === "examples"
              ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          Examples
        </button>
      </div>

      {activeTab === "yours" && isEditingForm && (
        <section className="card-elevated rounded-xl p-5 space-y-5">
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
            {editingId === "new" ? "New template" : "Edit template"}
          </h2>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            className="w-full px-3 py-2 rounded-lg input-base text-sm"
          />

          <FieldConfiguration
            fields={fields}
            onFieldsChange={setFields}
            extractionPrompt={prompt}
            onPromptChange={setPrompt}
          />

          <label className="flex items-center justify-between cursor-pointer pt-2 border-t border-[var(--border-subtle)]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)]">
                <Table2 className="w-4 h-4 text-[var(--text-tertiary)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Extract multiple rows
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  For tables, lists, or repeated data
                </p>
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

          <div className="pt-2 border-t border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)]">
                  <Braces className="w-4 h-4 text-[var(--text-tertiary)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Examples</p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Example output JSON to steer format/style — e.g. uppercase vendor names
                  </p>
                </div>
              </div>
              <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
                {exampleDrafts.length}/{MAX_EXAMPLES}
              </span>
            </div>

            {exampleDrafts.map((draft, i) => (
              <div key={i} className="rounded-lg bg-[var(--surface-inset)] border border-[var(--border-subtle)] p-2 space-y-1.5">
                <div className="flex items-start gap-2">
                  <textarea
                    value={draft.text}
                    onChange={(e) => updateExampleDraftText(i, e.target.value)}
                    onBlur={() => validateExampleDraft(i)}
                    placeholder='{"vendor": "ACME PTY LTD"}'
                    rows={2}
                    spellCheck={false}
                    className={`flex-1 px-2.5 py-1.5 rounded-md bg-[var(--surface-elevated)] border text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:ring-0 focus:outline-none transition-all resize-y ${
                      draft.error ? "border-[var(--error)]" : "border-transparent focus:border-[var(--accent-muted)]"
                    }`}
                    aria-label={`Example ${i + 1} output JSON`}
                    aria-invalid={draft.error ? true : undefined}
                  />
                  <button
                    onClick={() => removeExampleDraft(i)}
                    className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-all flex-shrink-0"
                    aria-label={`Remove example ${i + 1}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {draft.error && <p className="text-xs text-[var(--error)]">{draft.error}</p>}
              </div>
            ))}

            {exampleDrafts.length < MAX_EXAMPLES && (
              <button
                onClick={addExampleDraft}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] text-xs font-medium hover:border-[var(--accent-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Add example
              </button>
            )}
          </div>

          {error && <p className="text-sm text-[var(--error)]">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg btn-primary text-sm disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save template"}
            </button>
            <button
              onClick={cancelEdit}
              className="px-4 py-2 rounded-lg text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {activeTab === "examples" && (
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
            Start from an example
          </h2>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Curated templates for common document formats — add one to customize it.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PRESET_TEMPLATES.map((preset) => (
            <div key={preset.key} className="card-elevated rounded-xl p-4 flex flex-col gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{preset.name}</p>
                  {preset.extractMultiple && (
                    <span className="px-1.5 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-[10px] font-medium uppercase tracking-wide">
                      Multi-row
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">{preset.description}</p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {preset.fields.slice(0, 4).map((f) => (
                  <span
                    key={f.id}
                    className="px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] text-[var(--text-tertiary)] text-[11px]"
                  >
                    {f.name}
                  </span>
                ))}
                {preset.fields.length > 4 && (
                  <span className="px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] text-[var(--text-tertiary)] text-[11px]">
                    +{preset.fields.length - 4} more
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between mt-auto pt-1">
                <span className="text-xs text-[var(--text-tertiary)]">
                  {preset.fields.length} field{preset.fields.length === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => handleAddPreset(preset)}
                  disabled={addingPresetKey === preset.key}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] text-xs font-medium hover:border-[var(--accent-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all disabled:opacity-50"
                >
                  {addedPresetKey === preset.key ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Added
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      {addingPresetKey === preset.key ? "Adding…" : "Add to my templates"}
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      {activeTab === "yours" && (
      <section className="space-y-2">
        {deleteError && <p className="text-sm text-[var(--error)]">{deleteError}</p>}
        {isLoading ? (
          <div className="h-6 w-40 rounded-full bg-[var(--surface-overlay)] animate-pulse" />
        ) : templates.length === 0 && !isEditingForm ? (
          <p className="text-sm text-[var(--text-tertiary)]">
            No templates yet.{" "}
            <button
              type="button"
              onClick={() => setActiveTab("examples")}
              className="text-[var(--accent)] font-medium hover:underline"
            >
              Browse examples
            </button>{" "}
            to get started.
          </p>
        ) : (
          templates
            .filter((t) => t.id !== editingId)
            .map((t) => (
              <div
                key={t.id}
                className={`card-elevated rounded-xl p-4 flex items-center gap-4${
                  t.id === flashId ? " row-flash" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t.name}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    {t.fields.length} field{t.fields.length === 1 ? "" : "s"}
                    {t.extractMultiple ? " · multiple rows" : ""}
                  </p>
                </div>
                <button
                  onClick={() => startEdit(t)}
                  className="hit-44 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors flex-shrink-0"
                  aria-label={`Edit ${t.name}`}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {confirmDeleteId === t.id ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="px-2 py-1.5 rounded-md text-xs font-medium text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmDeleteId(t.id);
                    }}
                    className="hit-44 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors flex-shrink-0"
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))
        )}
      </section>
      )}
    </div>
  );
}
