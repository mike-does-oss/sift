/** Shared `prefers-reduced-motion` check — used to skip smooth-scroll/flash animations (DocumentView's scrollToMark, ResultsDisplay's flashCell) for users who've asked the OS to minimize motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}
