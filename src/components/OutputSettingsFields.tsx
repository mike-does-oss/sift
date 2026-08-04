"use client";

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
 * too. §13 label style (uppercase tracking-wider sub-heading), §4 voice
 * (plain, says what's off and what stays).
 */
export function OutputSettingsFields({ value, onChange }: OutputSettingsFieldsProps) {
  const hasFolder = value.outputDir.trim() !== "";

  return (
    <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
      <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
        Output
      </h3>

      <div>
        <input
          type="text"
          value={value.outputDir}
          onChange={(e) => onChange({ ...value, outputDir: e.target.value })}
          placeholder="~/Documents/sift-exports (optional)"
          className="w-full px-3 py-2 rounded-lg input-base text-sm font-mono"
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
          className="px-3 py-2 rounded-lg input-base text-sm"
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
        <button
          type="button"
          onClick={() => onChange({ ...value, keepResults: !value.keepResults })}
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
            value.keepResults ? "bg-[var(--accent)]" : "bg-[var(--surface-overlay)]"
          }`}
          aria-label={value.keepResults ? "Deactivate keep results" : "Activate keep results"}
          aria-pressed={value.keepResults}
        >
          <div
            className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
              value.keepResults ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
