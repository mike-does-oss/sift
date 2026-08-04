// Hardware-aware model suggestions for the Ollama download flow. Pure and
// dependency-free so it can run both server-side (Next API route) and inside
// the Electron main process (bundled by esbuild for the onboarding screen) —
// see src/app/api/system/route.ts and electron/main.ts.

export interface SystemInfo {
  /** Total system RAM in GB (caller rounds — see os.totalmem() usage). */
  totalRamGB: number;
  arch: string;
  platform: string;
}

export interface ModelRec {
  model: string; // ollama tag
  downloadSize: string; // human, e.g. "3.3 GB"
  vision: boolean;
  recommended: boolean; // exactly one true per list
  reason: string; // plain language, non-technical
  caveat?: string; // e.g. speed warning
}

const GPU_CAVEAT = "Large models can be slow without a dedicated GPU.";

/**
 * Apple Silicon Macs share fast unified memory between CPU and GPU, so large
 * local models behave well even without a discrete GPU. We can't reliably
 * detect a GPU on other platforms (Windows/Linux, Intel Macs), so everywhere
 * else we surface a caveat rather than guessing — never a hard blocker.
 */
function hasUnifiedMemory(sys: SystemInfo): boolean {
  return sys.platform === "darwin" && sys.arch === "arm64";
}

/** Appends the cross-cutting GPU caveat to the larger models (12b/27b) on any machine that isn't Apple Silicon. */
function withGpuCaveat(rec: ModelRec, sys: SystemInfo): ModelRec {
  if (hasUnifiedMemory(sys)) return rec;
  return { ...rec, caveat: GPU_CAVEAT };
}

/**
 * RAM-tiered recommendation table (RAM = total system RAM):
 *
 *   < 8 GB     -> gemma3:1b  (recommended, 815 MB, text-only)
 *                 gemma3:4b  (alt, 3.3 GB, vision, caveat: may be slow)
 *   8-15 GB    -> gemma3:4b  (recommended, 3.3 GB, vision)
 *                 gemma3:1b  (alt, 815 MB, text-only, faster)
 *   16-31 GB   -> gemma3:12b (recommended, 8.1 GB, vision)
 *                 gemma3:4b  (alt, 3.3 GB, vision, faster)
 *                 gemma3:1b  (alt, 815 MB, text-only, fastest)
 *   >= 32 GB   -> gemma3:27b (recommended, ~17 GB, vision)
 *                 gemma3:12b (alt, 8.1 GB, vision, faster)
 *                 gemma3:4b  (alt, 3.3 GB, vision, fastest)
 *
 * Cross-cutting: gemma3:12b and gemma3:27b always pick up a "slow without a
 * dedicated GPU" caveat unless the machine is Apple Silicon (see
 * withGpuCaveat above) — applied as a final pass below.
 */
export function recommendModels(sys: SystemInfo): ModelRec[] {
  const ram = sys.totalRamGB;
  let recs: ModelRec[];

  if (ram < 8) {
    recs = [
      {
        model: "gemma3:1b",
        downloadSize: "815 MB",
        vision: false,
        recommended: true,
        reason: `Light and fast — fits comfortably in ${ram} GB of memory. Text only.`,
      },
      {
        model: "gemma3:4b",
        downloadSize: "3.3 GB",
        vision: true,
        recommended: false,
        reason: "Good accuracy and reads images.",
        caveat: `May be slow with ${ram} GB of memory.`,
      },
    ];
  } else if (ram < 16) {
    recs = [
      {
        model: "gemma3:4b",
        downloadSize: "3.3 GB",
        vision: true,
        recommended: true,
        reason: `Good accuracy and reads images — the sweet spot for ${ram} GB.`,
      },
      {
        model: "gemma3:1b",
        downloadSize: "815 MB",
        vision: false,
        recommended: false,
        reason: "Faster, text only.",
      },
    ];
  } else if (ram < 32) {
    recs = [
      {
        model: "gemma3:12b",
        downloadSize: "8.1 GB",
        vision: true,
        recommended: true,
        reason: `Stronger accuracy, reads images — comfortable in ${ram} GB.`,
      },
      {
        model: "gemma3:4b",
        downloadSize: "3.3 GB",
        vision: true,
        recommended: false,
        reason: "Faster downloads and responses.",
      },
      {
        model: "gemma3:1b",
        downloadSize: "815 MB",
        vision: false,
        recommended: false,
        reason: "Fastest, text only.",
      },
    ];
  } else {
    recs = [
      {
        model: "gemma3:27b",
        downloadSize: "~17 GB",
        vision: true,
        recommended: true,
        reason: "Best local accuracy, reads images.",
      },
      {
        model: "gemma3:12b",
        downloadSize: "8.1 GB",
        vision: true,
        recommended: false,
        reason: "Faster downloads, still reads images.",
      },
      {
        model: "gemma3:4b",
        downloadSize: "3.3 GB",
        vision: true,
        recommended: false,
        reason: "Fastest, still reads images.",
      },
    ];
  }

  return recs.map((rec) => (rec.model === "gemma3:12b" || rec.model === "gemma3:27b" ? withGpuCaveat(rec, sys) : rec));
}

/**
 * Normalizes an Ollama model tag for installed-state comparisons. `/api/tags`
 * sometimes lists a pulled model with an explicit `:latest` suffix even when
 * the recommendation table above (and most user-typed input) omits it —
 * `gemma3:4b` and `gemma3:4b:latest` name the same installed model. Strips a
 * single trailing `:latest`; otherwise returns the trimmed tag unchanged.
 */
export function normalizeModelTag(tag: string): string {
  const trimmed = tag.trim();
  const suffix = ":latest";
  return trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed;
}

/**
 * True if `tag` names a model already present in `installed` (the tag list
 * from Ollama's `/api/tags`, e.g. `ProviderInfo.models` for the ollama
 * provider), tolerating the `:latest` suffix mismatch on either side — see
 * `normalizeModelTag`.
 */
export function isModelInstalled(tag: string, installed: readonly string[]): boolean {
  const target = normalizeModelTag(tag);
  return installed.some((m) => normalizeModelTag(m) === target);
}
