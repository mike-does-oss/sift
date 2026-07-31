import { writeFileSync, readFileSync } from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir";

export function saveBuffer(buf: Buffer, ext: string = "pdf"): { filePath: string; sizeBytes: number } {
  const rel = path.join("files", `${crypto.randomUUID()}.${ext}`);
  writeFileSync(path.join(DATA_DIR, rel), buf);
  return { filePath: rel, sizeBytes: buf.length };
}

export async function saveUpload(file: File, ext?: string): Promise<{ filePath: string; sizeBytes: number }> {
  const buf = Buffer.from(await file.arrayBuffer());
  return saveBuffer(buf, ext);
}

export function readDocument(filePath: string): Buffer {
  const abs = path.resolve(DATA_DIR, filePath);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error("Invalid file path");
  return readFileSync(abs);
}
