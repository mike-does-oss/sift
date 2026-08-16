import { isHosted } from "./lib/profile";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Local-only: the in-process tick has no hosted analogue — hosted has no
  // long-lived process, so cron routes (/api/jobs/process, /api/schedules/run)
  // drive the worker there instead (§SaaS-1 T3).
  if (isHosted()) return;
  const { runDueSchedules, processPendingJobs } = await import("./lib/jobs");
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDueSchedules();
      await processPendingJobs(50_000);
    } catch (err) {
      console.error("Worker tick failed:", err);
    } finally {
      running = false;
    }
  }, 60_000);
  console.log("[sift] background worker started (60s tick)");
}
