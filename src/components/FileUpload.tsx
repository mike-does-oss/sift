"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, Check } from "lucide-react";

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
            className="relative card-elevated rounded-xl p-4"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-[var(--success-subtle)] flex items-center justify-center">
                <FileText className="w-6 h-6 text-[var(--success)]" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Check className="w-3.5 h-3.5 text-[var(--success)]" strokeWidth={2.5} />
                  <span className="text-xs font-medium text-[var(--success)]">
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
                className="flex-shrink-0 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-all"
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
              border border-dashed rounded-xl cursor-pointer
              transition-all duration-200 ease-out
              ${
                isDragging
                  ? "border-[var(--accent)] bg-[var(--accent-subtle)] scale-[1.01]"
                  : "border-[var(--border-default)] hover:border-[var(--accent-muted)] bg-[var(--surface-elevated)]/50 hover:bg-[var(--surface-elevated)]"
              }
            `}
          >
            <input
              type="file"
              accept=".pdf,.eml,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,application/pdf,message/rfc822,text/plain,text/markdown,text/csv,image/png,image/jpeg,image/webp"
              onChange={handleFileInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <motion.div
              animate={isDragging ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className={`
                w-12 h-12 rounded-xl flex items-center justify-center mb-4
                ${isDragging ? "bg-[var(--accent)]" : "bg-[var(--surface-overlay)] border border-[var(--border-subtle)]"}
                transition-colors duration-200
              `}
            >
              <Upload
                className={`w-5 h-5 ${
                  isDragging ? "text-[var(--surface-base)]" : "text-[var(--text-tertiary)]"
                }`}
                strokeWidth={1.5}
              />
            </motion.div>
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
              {isDragging ? "Drop it" : "Drop a document to get started"}
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">
              or{" "}
              <span className="text-[var(--accent)] font-medium">browse files</span>
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
              PDF, email, image, or text — PDF, EML, TXT, MD, CSV, PNG, JPG, or WEBP
            </p>
          </motion.label>
        )}
      </AnimatePresence>
    </div>
  );
}
