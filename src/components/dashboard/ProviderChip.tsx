"use client";

import { useCallback, useEffect, useState } from "react";

type Provider = "ollama" | "anthropic" | "openai" | "gemini" | "openai-compatible";

interface Settings {
  provider: Provider;
  ollamaModel: string;
  anthropicModel: string;
  openaiModel: string;
  geminiModel: string;
  compatModel: string;
}

// Cloud provider display names for the "☁ Cloud · <provider> <model>" badge
// copy (playbook §4). Ollama has no entry here — it renders as "🔒 Local".
const CLOUD_PROVIDER_LABELS: Record<Exclude<Provider, "ollama">, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  "openai-compatible": "OpenAI-compatible",
};

function modelFor(settings: Settings): string {
  switch (settings.provider) {
    case "anthropic":
      return settings.anthropicModel;
    case "openai":
      return settings.openaiModel;
    case "gemini":
      return settings.geminiModel;
    case "openai-compatible":
      return settings.compatModel;
    default:
      return settings.ollamaModel;
  }
}

/** "🔒 Local · gemma3:4b" or "☁ Cloud · Anthropic claude-sonnet-5" (§4 privacy contract). */
function badgeCopy(settings: Settings): { emoji: string; text: string } {
  const model = modelFor(settings);
  if (settings.provider === "ollama") {
    return { emoji: "🔒", text: `Local · ${model}` };
  }
  return {
    emoji: "☁",
    text: `Cloud · ${CLOUD_PROVIDER_LABELS[settings.provider]} ${model}`,
  };
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

  const { emoji, text } = badgeCopy(settings);

  return (
    <div className="px-2 py-1.5">
      <div
        className="data flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--accent-tint)] text-xs font-medium text-[var(--accent)]"
        title={text}
        aria-label={text}
      >
        <span aria-hidden="true" className="flex-shrink-0 not-italic">
          {emoji}
        </span>
        <span className="truncate">{text}</span>
      </div>
    </div>
  );
}
