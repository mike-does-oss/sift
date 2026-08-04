// Client-safe single source of truth for what the upload surfaces accept.
// Server-side validation lives in src/lib/documents.ts (detectExtension);
// keep the two in sync when adding formats.

export const ACCEPTED_EXTENSIONS = [
  "pdf",
  "docx",
  "pptx",
  "eml",
  "txt",
  "md",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;

export const UPLOAD_ACCEPT_ATTR = [
  ...ACCEPTED_EXTENSIONS.map((e) => `.${e}`),
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "message/rfc822",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
].join(",");

export const UPLOAD_FORMATS_LABEL = "PDF, Word, PowerPoint, email, image, or text";

/** Filter a picked/dropped FileList to supported files by extension —
 * MIME types are unreliable for .eml/.md across browsers/OSes. */
export function filterSupportedFiles(fileList: FileList | File[]): File[] {
  return Array.from(fileList).filter((f) => {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
  });
}
