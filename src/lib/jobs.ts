// Thin facade over the profile-split jobs module (§SaaS-1 T3): the
// dialect-agnostic worker core lives in `./jobs/core`, which dispatches to
// `./jobs/store.local` (raw better-sqlite3, local profile) or
// `./jobs/store.pg` (single-statement Postgres, hosted profile) via
// `getJobStore()`. Existing imports keep working unchanged.
export {
  processPendingJobs,
  runDueSchedules,
  enqueueScheduleNow,
  enqueueScheduleArrival,
  kickJobWorker,
  getJobStore,
  resolveJobApiKey,
  MAX_ATTEMPTS,
} from "./jobs/core";
export type { JobStore, Snapshot } from "./jobs/core";
