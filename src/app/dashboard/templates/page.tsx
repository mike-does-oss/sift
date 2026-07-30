"use client";

import { useCallback, useEffect, useState } from "react";
import { FileJson, Plus, Pencil, Trash2, Table2, Sparkles, Check } from "lucide-react";
import { FieldConfiguration } from "@/components";
import type { ExtractionField } from "@/types";
import { PRESET_TEMPLATES } from "@/lib/presets";

interface Template {
  id: string;
  name: string;
  fields: ExtractionField[];
  prompt: string;
  extractMultiple: boolean;
}

const EMPTY_FIELD = (): ExtractionField => ({ id: `field-${Date.now()}`, name: "", type: "text" });

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // "new" or a template id
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [extractMultiple, setExtractMultiple] = useState(false);
  const [fields, setFields] = useState<ExtractionField[]>([EMPTY_FIELD()]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addingPresetKey, setAddingPresetKey] = useState<string | null>(null);
  const [addedPresetKey, setAddedPresetKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) setTemplates((await res.json()).templates ?? []);
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
    setEditingId("new");
    setName("");
    setPrompt("");
    setExtractMultiple(false);
    setFields([EMPTY_FIELD()]);
    setError(null);
  };

  const startEdit = (t: Template) => {
    setEditingId(t.id);
    setName(t.name);
    setPrompt(t.prompt);
    setExtractMultiple(t.extractMultiple);
    setFields(t.fields);
    setError(null);
  };

  const cancelEdit = () => setEditingId(null);

  const handleSave = async () => {
    const validFields = fields.filter((f) => f.name.trim() !== "");
    if (!name.trim() || validFields.length === 0) {
      setError("Name and at least one field are required");
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
        body: JSON.stringify({ name: name.trim(), fields: validFields, prompt, extractMultiple }),
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
    if (!res.ok) return;
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setConfirmDeleteId(null);
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
        {!isEditingForm && (
          <button
            onClick={startCreate}
            className="flex items-center gap-2 px-3 py-2 rounded-lg btn-primary text-sm"
          >
            <Plus className="w-4 h-4" />
            New template
          </button>
        )}
      </div>

      {isEditingForm && (
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

      <section className="space-y-2">
        {isLoading ? (
          <div className="h-6 w-40 rounded-full bg-[var(--surface-overlay)] animate-pulse" />
        ) : templates.length === 0 && !isEditingForm ? (
          <p className="text-sm text-[var(--text-tertiary)]">No templates yet.</p>
        ) : (
          templates
            .filter((t) => t.id !== editingId)
            .map((t) => (
              <div key={t.id} className="card-elevated rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t.name}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    {t.fields.length} field{t.fields.length === 1 ? "" : "s"}
                    {t.extractMultiple ? " · multiple rows" : ""}
                  </p>
                </div>
                <button
                  onClick={() => startEdit(t)}
                  className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors flex-shrink-0"
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
                    onClick={() => setConfirmDeleteId(t.id)}
                    className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors flex-shrink-0"
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))
        )}
      </section>
    </div>
  );
}
