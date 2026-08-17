"use client";

export interface DatasetOption {
  id: string;
  name: string;
}

export interface DeliverySettingsValue {
  ingestMode: "auto" | "attachments" | "email" | "both";
  processOnArrival: boolean;
  allowedSenders: string;
  datasetId: string; // "" = no dataset
  notifyEmail: boolean;
}

/** How each ingest mode reads in running text ("Ingesting …"). */
export const INGEST_MODE_SUMMARIES: Record<DeliverySettingsValue["ingestMode"], string> = {
  auto: "attachments, or the email itself if none",
  attachments: "attachments only",
  email: "email content only",
  both: "attachments and the email content",
};

interface DeliverySettingsFieldsProps {
  value: DeliverySettingsValue;
  onChange: (value: DeliverySettingsValue) => void;
  datasets: DatasetOption[];
  /** False when the parent already renders a DELIVERY card header (the
   * schedule detail page's edit flow) — avoids a stacked double heading. */
  showHeading?: boolean;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        on ? "bg-[var(--accent)]" : "bg-[var(--surface-overlay)]"
      }`}
      aria-label={label}
      aria-pressed={on}
    >
      <div
        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

/**
 * §INBOX T3: the compact "DELIVERY" sub-section of the hosted schedule
 * create/edit forms — how emailed-in messages become documents, whether
 * they're extracted on arrival, who may send, and where results land. Both
 * parents render it behind useHosted(), so the local profile never sees it.
 * Same idiom as OutputSettingsFields: §13 label style (uppercase
 * tracking-wider sub-heading, mono for data-shaped input), §4 voice.
 */
export function DeliverySettingsFields({ value, onChange, datasets, showHeading = true }: DeliverySettingsFieldsProps) {
  return (
    <div className={showHeading ? "space-y-3 pt-3 border-t border-[var(--border-subtle)]" : "space-y-3"}>
      {showHeading && (
        <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
          Delivery
        </h3>
      )}

      <div>
        <select
          value={value.ingestMode}
          onChange={(e) =>
            onChange({ ...value, ingestMode: e.target.value as DeliverySettingsValue["ingestMode"] })
          }
          className="w-full px-3 py-2 rounded-lg input-base text-sm"
          aria-label="Ingest mode"
        >
          <option value="auto">Smart — attachments, or the email itself if none</option>
          <option value="attachments">Attachments only</option>
          <option value="email">Email content only</option>
          <option value="both">Both</option>
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          What an email to this schedule&apos;s address turns into.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">Process on arrival</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            Extract each document as it arrives instead of waiting for the schedule.
          </p>
        </div>
        <Toggle
          on={value.processOnArrival}
          onClick={() => onChange({ ...value, processOnArrival: !value.processOnArrival })}
          label={value.processOnArrival ? "Deactivate process on arrival" : "Activate process on arrival"}
        />
      </div>

      <div>
        <input
          type="text"
          value={value.allowedSenders}
          onChange={(e) => onChange({ ...value, allowedSenders: e.target.value })}
          placeholder="billing@xero.com, @acme.com (optional)"
          className="w-full px-3 py-2 rounded-lg input-base text-sm font-mono"
          aria-label="Allowed senders"
        />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Only accept email from these addresses or domains. Empty accepts any sender.
        </p>
      </div>

      <div>
        <select
          value={value.datasetId}
          onChange={(e) => onChange({ ...value, datasetId: e.target.value })}
          className="w-full px-3 py-2 rounded-lg input-base text-sm"
          aria-label="Dataset"
        >
          <option value="">None</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Append each run&apos;s results to a dataset. Its headers must match the template&apos;s fields.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-[var(--text-secondary)]">Email me a summary after each run</p>
        <Toggle
          on={value.notifyEmail}
          onClick={() => onChange({ ...value, notifyEmail: !value.notifyEmail })}
          label={value.notifyEmail ? "Deactivate run summary email" : "Activate run summary email"}
        />
      </div>
    </div>
  );
}
