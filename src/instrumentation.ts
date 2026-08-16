export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Local-only: the in-process tick (and the raw-sqlite job store behind it)
  // has no hosted analogue — hosted runs the worker via cron routes
  // (§SaaS-1 T3). Importing ./lib/jobs on hosted would throw (getSqlite()).
  if (process.env.SIFT_PROFILE === "hosted") return;
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
