import { IMAGE_EXTENSIONS } from "./documents";

// Shared ingestion size caps — one source of truth for every path that
// accepts document bytes (manual upload route, §INBOX email-in webhook).

export const MAX_DOC_SIZE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

/** The size cap (and its human label) for a magic-byte-detected extension. */
export function sizeLimitFor(ext: string): { maxBytes: number; label: string } {
  return IMAGE_EXTENSIONS.has(ext)
    ? { maxBytes: MAX_IMAGE_SIZE_BYTES, label: "8MB" }
    : { maxBytes: MAX_DOC_SIZE_BYTES, label: "32MB" };
}
