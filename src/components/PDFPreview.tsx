"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText, Loader2 } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

// Set up PDF.js worker — bundle the worker asset from the installed package
// instead of fetching it from a CDN, so the app works fully offline and the
// worker build always matches the API build (no version-mismatch crash).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PDFPreviewProps {
  file: File | null;
}

export function PDFPreview({ file }: PDFPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load PDF document
  useEffect(() => {
    (async () => {
      if (!file) {
        setPdfDoc(null);
        setCurrentPage(1);
        setTotalPages(0);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
      } catch (err) {
        console.error("Error loading PDF:", err);
        setError("Failed to load PDF preview");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [file]);

  // Render current page
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current) return;

    try {
      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;

      // Calculate scale to fit container width
      const containerWidth = containerRef.current.clientWidth - 48;
      const viewport = page.getViewport({ scale: 1 });
      const fitScale = containerWidth / viewport.width;
      const finalScale = fitScale * scale;

      const scaledViewport = page.getViewport({ scale: finalScale });

      canvas.height = scaledViewport.height;
      canvas.width = scaledViewport.width;

      await page.render({
        canvasContext: context,
        viewport: scaledViewport,
      }).promise;
    } catch (err) {
      console.error("Error rendering page:", err);
    }
  }, [pdfDoc, currentPage, scale]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // Re-render on window resize
  useEffect(() => {
    const handleResize = () => renderPage();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [renderPage]);

  const goToPrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));

  if (!file) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-20 h-20 rounded-2xl bg-[var(--surface-elevated)] flex items-center justify-center mb-6 border border-[var(--border-subtle)]">
          <FileText className="w-10 h-10 text-[var(--text-tertiary)]" strokeWidth={1.5} />
        </div>
        <h3 className="font-display text-lg text-[var(--text-secondary)] mb-2">
          No Document
        </h3>
        <p className="text-sm text-[var(--text-tertiary)] max-w-[200px]">
          Upload a PDF to see the preview here
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin mb-4" />
        <p className="text-sm text-[var(--text-tertiary)]">Loading document...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-[var(--error)]/10 flex items-center justify-center mb-4">
          <FileText className="w-8 h-8 text-[var(--error)]" />
        </div>
        <p className="text-sm text-[var(--error)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50">
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-medium text-[var(--text-tertiary)] min-w-[48px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scale >= 3}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-medium text-[var(--text-tertiary)]">
            <span className="text-[var(--text-primary)]">{currentPage}</span>
            {" / "}
            {totalPages}
          </span>
          <button
            onClick={goToNextPage}
            disabled={currentPage >= totalPages}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Canvas Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-6 bg-[var(--surface-inset)]"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex justify-center"
          >
            <canvas
              ref={canvasRef}
              className="shadow-2xl rounded-sm bg-white"
              style={{
                maxWidth: "100%",
                height: "auto",
              }}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
