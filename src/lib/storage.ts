import { writeFileSync, readFileSync } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

export function saveBuffer(buf: Buffer): { filePath: string; sizeBytes: number } {
  const rel = path.join("files", `${crypto.randomUUID()}.pdf`);
  writeFileSync(path.join(DATA_DIR, rel), buf);
  return { filePath: rel, sizeBytes: buf.length };
}

export async function saveUpload(file: File): Promise<{ filePath: string; sizeBytes: number }> {
  const buf = Buffer.from(await file.arrayBuffer());
  return saveBuffer(buf);
}

export function readDocument(filePath: string): Buffer {
  const abs = path.resolve(DATA_DIR, filePath);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error("Invalid file path");
  return readFileSync(abs);
}
