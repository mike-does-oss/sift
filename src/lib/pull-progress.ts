import type { PullProgress } from "@/lib/api";

/**
 * Ollama's pull stream reports `completed`/`total` per layer (each `digest`
 * restarts its own byte counter), so naively using the latest line's
 * completed/total would make the percentage jump backwards every time a new
 * layer starts downloading. This tracks the last known completed/total for
 * each digest seen so far and sums across all of them to get an overall,
 * monotonically-increasing percentage.
 *
 * Returns `percent: null` (indeterminate) until at least one layer has
 * reported a total — e.g. during the initial "pulling manifest" phase.
 */
export function createPullProgressTracker() {
  const layers = new Map<string, { completed: number; total: number }>();

  return {
    update(progress: PullProgress): { status: string; percent: number | null } {
      if (progress.digest && typeof progress.total === "number") {
        layers.set(progress.digest, {
          completed: progress.completed ?? 0,
          total: progress.total,
        });
      }

      let completedSum = 0;
      let totalSum = 0;
      for (const layer of layers.values()) {
        completedSum += layer.completed;
        totalSum += layer.total;
      }

      // Note: if Ollama announces a large new layer mid-download the summed
      // ratio can dip briefly. That's accepted — layers are normally all
      // announced up front, and a truthful dip beats holding a misleading
      // "100%" while bytes are still downloading.
      const percent = totalSum > 0 ? Math.min(100, Math.round((completedSum / totalSum) * 100)) : null;
      return { status: progress.status, percent };
    },
  };
}
