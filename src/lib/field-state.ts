import type { ExtractionField } from "@/types";

/** The extract workspace's untouched starting config: one empty-ish text field named "name". */
export const DEFAULT_FIELDS: ExtractionField[] = [{ id: "field-1", name: "name", type: "text" }];

/**
 * True when `fields` is still the untouched single starter field — the bar
 * for "replace without confirming" shared by the scaffold flow (§T2.6) and
 * the template-load flow (both otherwise confirm before clobbering whatever
 * field config the user has built up).
 */
export function isDefaultFieldState(fields: ExtractionField[]): boolean {
  return (
    fields.length === 1 &&
    fields[0].name === DEFAULT_FIELDS[0].name &&
    fields[0].type === DEFAULT_FIELDS[0].type &&
    !fields[0].description
  );
}
