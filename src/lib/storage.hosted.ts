import { put } from "@vercel/blob";

/**
 * Hosted (multi-tenant) storage backend: documents live in Vercel Blob and
 * `documents.filePath` stores the blob URL returned by `put()`. URLs are
 * unguessable (random suffix) but public, mirroring the donor app's model;
 * row-level ownership checks remain the access-control layer.
 */

const BLOB_HOST_SUFFIX = ".vercel-storage.com";

/**
 * Reduces an arbitrary client filename to a safe blob pathname segment and
 * stamps it with the magic-byte-detected extension (same "content wins over
 * the client's extension" rule the local backend applies to on-disk names).
 */
function blobPathname(filename: string, ext: string): string {
  const base = (filename.split(/[/\\]/).pop() ?? "")
    .replace(/\.[^.]*$/, "") // drop the client extension; the detected one is appended below
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._]+/, "");
  return `docs/${base || "document"}.${ext}`;
}

export async function saveBufferHosted(
  buf: Buffer,
  filename: string,
  ext: string
): Promise<{ filePath: string; sizeBytes: number }> {
  const blob = await put(blobPathname(filename, ext), buf, {
    access: "public",
    addRandomSuffix: true,
  });
  return { filePath: blob.url, sizeBytes: buf.length };
}

export async function readDocumentHosted(filePath: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(filePath);
  } catch {
    throw new Error("Invalid document URL");
  }
  // A tampered documents row must not be able to point the worker at an
  // arbitrary URL (SSRF): only https Vercel Blob hosts are fetchable.
  if (url.protocol !== "https:" || !url.hostname.endsWith(BLOB_HOST_SUFFIX)) {
    throw new Error("Invalid document URL: untrusted host");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch document from blob storage (status ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
