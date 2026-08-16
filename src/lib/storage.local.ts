import { writeFileSync, readFileSync } from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir";

/**
 * Local (single-user) storage backend: documents live on disk under
 * `DATA_DIR/files/<uuid>.<ext>` and `documents.filePath` stores the
 * DATA_DIR-relative path. Behavior is intentionally identical to the
 * pre-split sync implementation — only the Promise wrapper is new (the
 * facade's contract is async because the hosted backend has to be).
 */
export async function saveBufferLocal(
  buf: Buffer,
  ext: string
): Promise<{ filePath: string; sizeBytes: number }> {
  const rel = path.join("files", `${crypto.randomUUID()}.${ext}`);
  writeFileSync(path.join(DATA_DIR, rel), buf);
  return { filePath: rel, sizeBytes: buf.length };
}

export async function readDocumentLocal(filePath: string): Promise<Buffer> {
  const abs = path.resolve(DATA_DIR, filePath);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error("Invalid file path");
  return readFileSync(abs);
}
