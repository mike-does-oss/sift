"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Table2, FolderOpen, Save } from "lucide-react";
import { FileUpload, FieldConfiguration, ResultsDisplay, PDFPreview } from "@/components";
import type { ExtractionField, ExtractionData } from "@/types";
import { PRESET_TEMPLATES } from "@/lib/presets";

interface Template {
  id: string;
  name: string;
  fields: ExtractionField[];
  prompt: string;
  extractMultiple: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Local",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export default function DashboardPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extractionPrompt, setExtractionPrompt] = useState("");
  const [extractMultiple, setExtractMultiple] = useState(false);
  const [fields, setFields] = useState<ExtractionField[]>([
    { id: "field-1", name: "name", type: "text" },
  ]);
  const [results, setResults] = useState<ExtractionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedWith, setExtractedWith] = useState<{ provider: string; model: string } | null>(
    null
  );

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
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

  const handleLoadTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;

    if (templateId.startsWith("preset:")) {
      const presetKey = templateId.slice("preset:".length);
      const preset = PRESET_TEMPLATES.find((p) => p.key === presetKey);
      if (!preset) return;
      // Deep-copy so in-editor edits never mutate the module-level constant.
      setFields(preset.fields.map((f) => ({ ...f })));
      setExtractionPrompt(preset.prompt);
      setExtractMultiple(preset.extractMultiple);
      return;
    }

    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setFields(template.fields);
    setExtractionPrompt(template.prompt);
    setExtractMultiple(template.extractMultiple);
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
    setExtractedWith(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("fields", JSON.stringify(validFields));
      formData.append("prompt", extractionPrompt);
      formData.append("extractMultiple", extractMultiple.toString());

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || "Extraction failed");
      } else {
        setResults(data.data);
        if (data.provider && data.model) {
          setExtractedWith({ provider: data.provider, model: data.model });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    setResults(null);
    setError(null);
    setExtractedWith(null);
  };

  const canExtract = selectedFile && fields.some((f) => f.name.trim() !== "");

  return (
    <div className="flex" style={{ minHeight: "100vh" }}>
      {/* Left Panel - Document Preview */}
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="w-1/2 border-r border-[var(--border-subtle)] bg-[var(--surface-inset)] flex flex-col sticky top-0"
        style={{ height: "100vh" }}
      >
        <div className="flex-shrink-0 px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]/30">
          <h2 className="font-display text-sm text-[var(--text-secondary)]">
            Document Preview
          </h2>
        </div>
        <div className="flex-1 overflow-hidden">
          <PDFPreview file={selectedFile} />
        </div>
      </motion.aside>

      {/* Right Panel - Controls */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="w-1/2 flex flex-col"
      >
        <div className="flex-1 overflow-auto">
          <div className="p-8 space-y-8">
            {/* Upload Section */}
            <section className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-xs font-semibold">
                  1
                </span>
                <h2 className="font-display text-xl text-[var(--text-primary)]">
                  Upload Document
                </h2>
              </div>
              <FileUpload
                onFileSelect={setSelectedFile}
                selectedFile={selectedFile}
                onClear={handleClear}
              />
            </section>

            {/* Templates Section */}
            <section className="animate-slide-up" style={{ animationDelay: "0.15s" }}>
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

                {saveStatus === "saved" && (
                  <span className="text-xs text-[var(--success)]">Saved</span>
                )}
                {saveStatus === "error" && (
                  <span className="text-xs text-[var(--error)]">Couldn&apos;t save template</span>
                )}
              </div>
            </section>

            {/* Configuration Section */}
            <section className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-xs font-semibold">
                  2
                </span>
                <h2 className="font-display text-xl text-[var(--text-primary)]">
                  Define Extraction
                </h2>
              </div>
              <div className="card-elevated rounded-xl p-5">
                <FieldConfiguration
                  fields={fields}
                  onFieldsChange={setFields}
                  extractionPrompt={extractionPrompt}
                  onPromptChange={setExtractionPrompt}
                />

                {/* Extract Multiple Toggle */}
                <div className="mt-5 pt-5 border-t border-[var(--border-subtle)]">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:border-[var(--accent-muted)] transition-colors">
                        <Table2 className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent)] transition-colors" />
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
                        extractMultiple
                          ? "bg-[var(--accent)]"
                          : "bg-[var(--surface-overlay)]"
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
              </div>
            </section>

            {/* Extract Button */}
            <section className="animate-slide-up" style={{ animationDelay: "0.3s" }}>
              <motion.button
                whileHover={canExtract && !isLoading ? { scale: 1.01 } : {}}
                whileTap={canExtract && !isLoading ? { scale: 0.99 } : {}}
                onClick={handleExtract}
                disabled={!canExtract || isLoading}
                className="w-full py-4 px-6 rounded-xl btn-primary text-base flex items-center justify-center gap-3"
              >
                {isLoading ? (
                  <>
                    <span className="w-5 h-5 border-2 border-[var(--surface-base)]/30 border-t-[var(--surface-base)] rounded-full animate-spin" />
                    <span>Extracting...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>Extract Data</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </motion.button>
            </section>

            {/* Results Section */}
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
                      3
                    </span>
                    <h2 className="font-display text-xl text-[var(--text-primary)]">
                      Results
                    </h2>
                  </div>

                  {extractedWith && !isLoading && !error && (
                    <p className="text-xs text-[var(--text-tertiary)] mb-3">
                      Extracted with{" "}
                      {PROVIDER_LABELS[extractedWith.provider] ?? extractedWith.provider} ·{" "}
                      {extractedWith.model}
                    </p>
                  )}

                  <ResultsDisplay
                    results={results}
                    fields={fields.filter((f) => f.name.trim() !== "")}
                    isLoading={isLoading}
                    error={error}
                  />
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
