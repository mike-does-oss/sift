export interface UploadedDocument {
  id: string;
  filename: string;
  filePath: string;
  sizeBytes: number;
  scheduleId: string | null;
  processedAt: string | null;
  createdAt: string;
}

/**
 * Uploads a PDF to local storage via a simple multipart POST and returns the
 * resulting `documents` row. Replaces the donor's @vercel/blob client — Sift
 * stores files on disk (see `src/lib/storage.ts`), so there's no separate
 * blob-registration step.
 */
export async function uploadDocument(file: File, scheduleId?: string): Promise<UploadedDocument> {
  const formData = new FormData();
  formData.append("file", file);
  if (scheduleId) formData.append("scheduleId", scheduleId);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to upload ${file.name}`);
  }
  return data.document;
}
