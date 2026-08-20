"use client";

import { InstrumentSwitch } from "./InstrumentSwitch";

export interface OutputSettingsValue {
  outputDir: string;
  outputFormat: "csv" | "json" | "both";
  keepResults: boolean;
}

interface OutputSettingsFieldsProps {
  value: OutputSettingsValue;
  onChange: (value: OutputSettingsValue) => void;
}

/**
 * §output-dest: the compact "OUTPUT" sub-section shared by the batch and
 * schedule create/edit forms — a folder to auto-write results to, a format
 * (shown once a folder is set), and whether to keep results in the database
 * too. Bench-instrument label style (etched micro-label sub-heading), §4 voice
 * (plain, says what's off and what stays).
 */
export function OutputSettingsFields({ value, onChange }: OutputSettingsFieldsProps) {
  const hasFolder = value.outputDir.trim() !== "";

  return (
    <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
      <h3 className="etched-label">Output</h3>

      <div>
        <input
          type="text"
          value={value.outputDir}
          onChange={(e) => onChange({ ...value, outputDir: e.target.value })}
          placeholder="~/Documents/sift-exports (optional)"
          className="w-full px-3 py-2 input-base text-sm font-mono"
          aria-label="Output folder"
        />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          When set, results are written here automatically — one file per batch/run.
        </p>
      </div>

      {hasFolder && (
        <select
          value={value.outputFormat}
          onChange={(e) =>
            onChange({ ...value, outputFormat: e.target.value as OutputSettingsValue["outputFormat"] })
          }
          className="px-3 py-2 input-base text-sm"
          aria-label="Output format"
        >
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
          <option value="both">Both</option>
        </select>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">Keep results in the app&apos;s database</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            Off: results are cleared from History once the file is written. Status and errors are kept.
          </p>
        </div>
        <InstrumentSwitch
          checked={value.keepResults}
          onChange={(keepResults) => onChange({ ...value, keepResults })}
          ariaLabel="Keep results in the app's database"
        />
      </div>
    </div>
  );
}
