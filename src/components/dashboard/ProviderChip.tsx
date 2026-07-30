"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive, Sparkles, Cloud } from "lucide-react";

type Provider = "ollama" | "anthropic" | "openai";

interface Settings {
  provider: Provider;
  ollamaModel: string;
  anthropicModel: string;
  openaiModel: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: "Local",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const PROVIDER_ICONS: Record<Provider, typeof HardDrive> = {
  ollama: HardDrive,
  anthropic: Sparkles,
  openai: Cloud,
};

function modelFor(settings: Settings): string {
  if (settings.provider === "anthropic") return settings.anthropicModel;
  if (settings.provider === "openai") return settings.openaiModel;
  return settings.ollamaModel;
}

/**
 * Small sidebar pill showing the active extraction provider + model, e.g.
 * "Local · gemma3:4b". Refetches whenever the Settings page saves changes
 * (it dispatches a `window` "settings-changed" event) so the pill never goes
 * stale without a full page reload.
 */
export function ProviderChip() {
  const [settings, setSettings] = useState<Settings | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data.settings);
    } catch {
      // convenience readout — ignore transient failures
    }
  }, []);

  useEffect(() => {
    (async () => {
      await fetchSettings();
    })();
    const handleSettingsChanged = () => {
      (async () => {
        await fetchSettings();
      })();
    };
    window.addEventListener("settings-changed", handleSettingsChanged);
    return () => window.removeEventListener("settings-changed", handleSettingsChanged);
  }, [fetchSettings]);

  if (!settings) {
    return (
      <div className="px-2 py-2">
        <div className="h-6 w-28 rounded-full bg-[var(--surface-overlay)] animate-pulse" />
      </div>
    );
  }

  const Icon = PROVIDER_ICONS[settings.provider];

  return (
    <div className="px-2 py-1.5">
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--surface-overlay)] text-xs font-medium text-[var(--text-secondary)]"
        title={`${PROVIDER_LABELS[settings.provider]} · ${modelFor(settings)}`}
      >
        <Icon className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" strokeWidth={1.75} />
        <span className="truncate">
          {PROVIDER_LABELS[settings.provider]} · {modelFor(settings)}
        </span>
      </div>
    </div>
  );
}
