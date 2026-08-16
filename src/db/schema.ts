import { isHosted } from "../lib/profile";
import * as sqliteSchema from "./schema.sqlite";
import * as pgSchema from "./schema.pg";

// Profile selector: exports the ACTIVE dialect's tables under the names the
// rest of the app already imports. The two schema modules have identical
// logical shape and runtime JS value mappings (see schema.pg.ts), so the
// sqlite types serve as the shared type anchor for both. Hosted-only code
// (e.g. auth) imports `./schema.pg` directly for the `users` table.
const active = (isHosted() ? pgSchema : sqliteSchema) as unknown as typeof sqliteSchema;

export const { templates, documents, batches, jobs, schedules, settings, datasets, datasetRows } = active;

export type {
  DbTemplate,
  DbDocument,
  DbBatch,
  DbJob,
  DbSchedule,
  DbDataset,
  DbDatasetRow,
} from "./schema.sqlite";
