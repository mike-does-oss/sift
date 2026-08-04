"use client";

import { useState } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { Plus, X, GripVertical, Type, Hash, Calendar, ToggleLeft, List, MessageSquarePlus, Wand2, Loader2 } from "lucide-react";
import type { ExtractionField, FieldType } from "@/types";

/**
 * Prompt-scaffolding affordance (§T2.6) rendered next to the Context
 * textarea — visible only when the caller's grounded-mode toggle is on
 * (`visible`). The parent (dashboard page) owns the actual API call,
 * non-default-fields check, and apply/replace decision; this component only
 * renders the button/spinner/inline-confirm/error based on the state it's
 * handed.
 */
interface ScaffoldSlot {
  visible: boolean;
  isRunning: boolean;
  error: string | null;
  confirming: boolean;
  onBuild: () => void;
  onConfirmReplace: () => void;
  onCancelConfirm: () => void;
}

interface FieldConfigurationProps {
  fields: ExtractionField[];
  onFieldsChange: (fields: ExtractionField[]) => void;
  extractionPrompt: string;
  onPromptChange: (prompt: string) => void;
  scaffold?: ScaffoldSlot;
}

const fieldTypes: { value: FieldType; label: string; icon: React.ReactNode }[] = [
  { value: "text", label: "Text", icon: <Type className="w-3.5 h-3.5" /> },
  { value: "number", label: "Number", icon: <Hash className="w-3.5 h-3.5" /> },
  { value: "date", label: "Date", icon: <Calendar className="w-3.5 h-3.5" /> },
  { value: "boolean", label: "Boolean", icon: <ToggleLeft className="w-3.5 h-3.5" /> },
  { value: "array", label: "List", icon: <List className="w-3.5 h-3.5" /> },
];

export function FieldConfiguration({
  fields,
  onFieldsChange,
  extractionPrompt,
  onPromptChange,
  scaffold,
}: FieldConfigurationProps) {
  const [isAddingField, setIsAddingField] = useState(false);
  // Field ids whose description input has been explicitly toggled open by
  // the user. A field with a non-empty description is always shown as
  // visible too (see `isDescriptionVisible`), independent of this set.
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());

  const toggleDescription = (id: string) => {
    setExpandedDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isDescriptionVisible = (field: ExtractionField) =>
    expandedDescriptions.has(field.id) || Boolean(field.description);

  const addField = () => {
    const newField: ExtractionField = {
      id: `field-${Date.now()}`,
      name: "",
      type: "text",
    };
    onFieldsChange([...fields, newField]);
    setIsAddingField(true);
    setTimeout(() => setIsAddingField(false), 100);
  };

  const updateField = (id: string, updates: Partial<ExtractionField>) => {
    onFieldsChange(
      fields.map((field) =>
        field.id === id ? { ...field, ...updates } : field
      )
    );
  };

  const removeField = (id: string) => {
    onFieldsChange(fields.filter((field) => field.id !== id));
  };

  const clearAllFields = () => {
    onFieldsChange([]);
  };

  return (
    <div className="space-y-5">
      {/* Extraction Context */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <label
            htmlFor="extraction-prompt"
            className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
          >
            Context
          </label>
          {scaffold?.visible && (
            <button
              type="button"
              onClick={scaffold.onBuild}
              disabled={!extractionPrompt.trim() || scaffold.isRunning}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] text-xs font-medium hover:border-[var(--accent-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[var(--border-default)] disabled:hover:text-[var(--text-secondary)] disabled:hover:bg-transparent"
            >
              {scaffold.isRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Building…
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5" />
                  Build fields from description
                </>
              )}
            </button>
          )}
        </div>
        <textarea
          id="extraction-prompt"
          value={extractionPrompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Describe what you're extracting, e.g., 'Invoice details from a vendor bill'"
          className="w-full px-3 py-2.5 rounded-lg input-base text-sm resize-none"
          rows={2}
        />
        {scaffold?.visible && scaffold.confirming && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-muted)]">
            <span className="text-xs text-[var(--text-secondary)] flex-1">
              Replace current fields with the scaffolded set?
            </span>
            <button
              onClick={scaffold.onConfirmReplace}
              className="px-2 py-1 rounded-md text-xs font-medium text-[var(--accent)] hover:bg-[var(--surface-elevated)] transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={scaffold.onCancelConfirm}
              className="px-2 py-1 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        {scaffold?.visible && scaffold.error && !scaffold.confirming && (
          <p className="mt-2 text-xs text-[var(--error)]">{scaffold.error}</p>
        )}
      </div>

      {/* Field Definitions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
            Fields
          </label>
          <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
            {fields.length}
          </span>
        </div>

        <Reorder.Group
          axis="y"
          values={fields}
          onReorder={onFieldsChange}
          className="space-y-2"
        >
          <AnimatePresence mode="popLayout">
            {fields.map((field) => (
              <Reorder.Item
                key={field.id}
                value={field}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
                className="group"
              >
                <div className="rounded-lg bg-[var(--surface-inset)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors">
                  <div className="flex items-center gap-2 p-2">
                    <div className="cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors p-1">
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>

                    <input
                      type="text"
                      value={field.name}
                      onChange={(e) => updateField(field.id, { name: e.target.value })}
                      placeholder="Field name"
                      autoFocus={isAddingField && fields[fields.length - 1]?.id === field.id}
                      className="flex-1 px-2.5 py-1.5 rounded-md bg-[var(--surface-elevated)] border border-transparent text-sm font-medium text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-muted)] focus:ring-0 focus:outline-none transition-all"
                    />

                    <select
                      value={field.type}
                      onChange={(e) =>
                        updateField(field.id, { type: e.target.value as FieldType })
                      }
                      className="px-2.5 py-1.5 rounded-md bg-[var(--surface-elevated)] border border-transparent text-xs font-medium text-[var(--text-secondary)] focus:border-[var(--accent-muted)] focus:ring-0 focus:outline-none transition-all appearance-none cursor-pointer min-w-[90px]"
                    >
                      {fieldTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => toggleDescription(field.id)}
                      className={`p-1.5 rounded-md transition-all ${
                        isDescriptionVisible(field)
                          ? "text-[var(--accent)] bg-[var(--accent-subtle)] opacity-100"
                          : "text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] opacity-0 group-hover:opacity-100"
                      }`}
                      aria-label={
                        isDescriptionVisible(field) ? "Hide field description" : "Add field description"
                      }
                      title="Describe what to extract for this field"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => removeField(field.id)}
                      className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-all opacity-0 group-hover:opacity-100"
                      aria-label="Remove field"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isDescriptionVisible(field) && (
                    <div className="flex px-2 pb-1.5 -mt-0.5">
                      {/* spacers mirror the drag handle (left) and the two icon
                          buttons (right) so the input aligns with name + type */}
                      <div className="w-[30px] mr-2 shrink-0" aria-hidden />
                      <input
                        type="text"
                        value={field.description ?? ""}
                        onChange={(e) =>
                          updateField(field.id, { description: e.target.value === "" ? undefined : e.target.value })
                        }
                        placeholder="Guidance the model reads — e.g. 'Total after tax, without currency symbol'"
                        className="flex-1 px-2.5 py-1 rounded-md bg-transparent border border-transparent text-xs text-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-subtle)] focus:border-[var(--accent-muted)] focus:bg-[var(--surface-elevated)] focus:ring-0 focus:outline-none transition-all"
                      />
                      <div className="w-[68px] shrink-0" aria-hidden />
                    </div>
                  )}
                </div>
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>

        {fields.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8 rounded-lg border border-dashed border-[var(--border-default)]"
          >
            <p className="text-sm text-[var(--text-tertiary)]">No fields defined</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1 opacity-60">
              Add fields to specify extraction targets
            </p>
          </motion.div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 mt-4">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={addField}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] text-xs font-medium hover:border-[var(--accent-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Field
          </motion.button>

          {fields.length > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={clearAllFields}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[var(--text-tertiary)] text-xs font-medium hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-all"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
