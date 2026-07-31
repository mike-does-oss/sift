import { extractText, getDocumentProxy } from "unpdf";

const MAX_CHARS = 40_000;

export type PdfTextResult =
  | { success: true; text: string }
  | { success: false; error: string };

/**
 * Shared by engines that can't take PDFs natively (ollama, the
 * openai-compatible/gemini engine) and instead extract text locally via
 * unpdf before sending it to the model. Truncates to keep prompts bounded.
 */
export async function pdfToText(pdfBase64: string): Promise<PdfTextResult> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(pdfBase64, "base64")));
    ({ text } = await extractText(pdf, { mergePages: true }));
  } catch {
    return { success: false, error: "Couldn't read this PDF — the file may be corrupted or not a real PDF." };
  }
  if (!text.trim()) {
    return { success: false, error: "No selectable text found in this PDF. Text extraction only in v0 — scanned documents need a cloud provider (or wait for vision support)." };
  }
  const truncated = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n[document truncated]" : text;
  return { success: true, text: truncated };
}
