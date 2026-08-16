import { isHosted } from "./profile";
import { readDocumentLocal, saveBufferLocal } from "./storage.local";
import { readDocumentHosted, saveBufferHosted } from "./storage.hosted";

/**
 * Profile-split document storage facade. Local (default) stores files on
 * disk under DATA_DIR with a relative `filePath`; hosted (`SIFT_PROFILE=
 * hosted`) stores them in Vercel Blob with the blob URL as `filePath`.
 * The profile is resolved per call, not at module load, so the backends
 * stay swappable under test.
 *
 * @param filename the client's original filename — used (sanitized) for the
 *   hosted blob pathname; ignored by the local backend.
 * @param ext the magic-byte-detected extension (see `detectExtension`) —
 *   names the stored object with its real type on both backends.
 */
export async function saveBuffer(
  buf: Buffer,
  filename: string,
  ext: string = "pdf"
): Promise<{ filePath: string; sizeBytes: number }> {
  return isHosted() ? saveBufferHosted(buf, filename, ext) : saveBufferLocal(buf, ext);
}

export async function readDocument(filePath: string): Promise<Buffer> {
  return isHosted() ? readDocumentHosted(filePath) : readDocumentLocal(filePath);
}
