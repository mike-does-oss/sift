"use client";

import { useCallback, useState } from "react";
import { UPLOAD_ACCEPT_ATTR } from "@/lib/upload-accept";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X } from "lucide-react";

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onClear: () => void;
}

export function FileUpload({ onFileSelect, selectedFile, onClear }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {selectedFile ? (
          <motion.div
            key="file-selected"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="relative card-elevated p-4"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded bg-[var(--well)] border border-[var(--hairline)] flex items-center justify-center">
                <FileText className="w-6 h-6 text-[var(--ink-dim)]" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="led led-on" aria-hidden />
                  <span className="data text-[11px] uppercase tracking-[0.06em] text-[var(--ink-dim)]">
                    Ready
                  </span>
                </div>
                <p className="text-sm font-medium truncate text-[var(--text-primary)]">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
              <button
                onClick={onClear}
                className="flex-shrink-0 p-2 rounded text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-all"
                aria-label="Remove file"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.label
            key="upload-zone"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative flex flex-col items-center justify-center w-full py-10 px-6
              border border-dashed rounded-md cursor-pointer
              transition-colors duration-200 ease-out
              ${
                isDragging
                  ? "border-[var(--phosphor-dim)] bg-[var(--phosphor-well)]"
                  : "border-[var(--hairline-strong)] hover:border-[var(--ink-faint)] bg-[var(--well)]"
              }
            `}
          >
            <input
              type="file"
              accept={UPLOAD_ACCEPT_ATTR}
              onChange={handleFileInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div
              className={`
                w-12 h-12 rounded flex items-center justify-center mb-4 border
                ${
                  isDragging
                    ? "bg-[var(--phosphor-well)] border-[var(--phosphor-dim)]"
                    : "bg-[var(--panel-raised)] border-[var(--hairline)]"
                }
                transition-colors duration-200
              `}
            >
              <Upload
                className={`w-5 h-5 ${
                  isDragging ? "text-[var(--phosphor)]" : "text-[var(--text-tertiary)]"
                }`}
                strokeWidth={1.5}
              />
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
              {isDragging ? "Drop it" : "Drop a document to get started"}
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">
              or{" "}
              <span className="text-[var(--accent)] font-medium">browse files</span>
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-1">PDF, Word, PowerPoint, email, image, or text</p>
          </motion.label>
        )}
      </AnimatePresence>
    </div>
  );
}
