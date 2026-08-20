"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  Layers,
  FileJson,
  Database,
  Settings,
  Moon,
  Sun,
  LogOut,
} from "lucide-react";
import { signOutAction } from "@/app/dashboard/actions";
import { SiftWordmark } from "@/components/brand/SiftWordmark";

// UI-2 U1 consolidated nav: Batches/Schedules/History collapsed into "Runs"
// (tabs at /dashboard/runs); /dashboard is the overview home and the extract
// workspace lives at /dashboard/extract. `alsoActiveOn` covers routes that
// belong to a section without living under its href — the batch/schedule
// detail pages (and the legacy list routes, which redirect into the tabs).
const NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  icon: typeof Sparkles;
  alsoActiveOn?: readonly string[];
}> = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/extract", label: "Extract", icon: Sparkles },
  { href: "/dashboard/templates", label: "Templates", icon: FileJson },
  {
    href: "/dashboard/runs",
    label: "Runs",
    icon: Layers,
    alsoActiveOn: ["/dashboard/batches", "/dashboard/schedules", "/dashboard/history"],
  },
  { href: "/dashboard/datasets", label: "Datasets", icon: Database },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function isNavItemActive(item: (typeof NAV_ITEMS)[number], pathname: string): boolean {
  if (item.href === "/dashboard") return pathname === item.href;
  const prefixes = [item.href, ...(item.alsoActiveOn ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const THEME_STORAGE_KEY = "sift-theme";

// `accountEmail` is non-null only on the hosted profile (the dashboard layout
// passes the Neon Auth session email); local passes null and gets no account
// block — the local profile has no accounts at all.
export function Sidebar({ accountEmail = null }: { accountEmail?: string | null }) {
  const pathname = usePathname();
  const [darkMode, setDarkMode] = useState(false);
  // Hosted-only usage mini-bar (§SaaS-1 T6): monthly used/limit under the
  // account block, linking to Settings for the full plan card. Local profile
  // (`accountEmail === null`) never fetches — the sidebar stays byte-identical.
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  useEffect(() => {
    if (accountEmail === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/usage");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || data.unlimited || typeof data.used !== "number") return;
        setUsage({ used: data.used, limit: data.limit });
      } catch {
        // convenience readout — the settings page has the authoritative meter
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountEmail, pathname]);

  useEffect(() => {
    // One-time sync from browser storage/media-query (external systems) on mount,
    // after the server-rendered (theme-less) markup has hydrated — avoids an
    // SSR/client markup mismatch that a render-time read of localStorage would cause.
    //
    // Bench-instrument theme inversion (DESIGN.md): dark is now the DEFAULT
    // calibration (:root) and light is the opt-in (`html.light`) — the old
    // world was the reverse (`html.dark` opt-in). The stored preference keeps
    // its key ("sift-theme") and values ("dark"/"light") and maps as:
    //   stored "dark"  → default (no class)   — same look the user chose
    //   stored "light" → html.light           — same look the user chose
    //   nothing stored → OS prefers-color-scheme, falling back to dark
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const isDark =
      stored === "dark" ||
      (stored === null && !window.matchMedia?.("(prefers-color-scheme: light)").matches);
    document.documentElement.classList.toggle("light", !isDark);
    // Pre-inversion sessions may have left the (now meaningless) class behind.
    document.documentElement.classList.remove("dark");
    // Correcting from an external system (localStorage/matchMedia) post-hydration is intentional here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDarkMode(isDark);
  }, []);

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("light", !next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  };

  return (
    <aside className="w-60 flex-shrink-0 h-screen sticky top-0 flex flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50">
      <div className="flex items-center px-5 h-14 border-b border-[var(--border-subtle)] flex-shrink-0">
        <SiftWordmark markSize={30} textClassName="text-lg" />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = isNavItemActive(item, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--phosphor-well)] text-[var(--phosphor)] shadow-[inset_2px_0_0_0_var(--phosphor)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)]"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-shrink-0 px-3 py-3 border-t border-[var(--border-subtle)] space-y-1">
        {/* Provider badge lives in the workspace action bar only — it was
            duplicated here and removed on founder feedback. */}
        <div
          className={`flex items-center gap-1 px-2 pt-1 ${
            accountEmail !== null ? "justify-between" : "justify-end"
          }`}
        >
          {accountEmail !== null && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--hairline)] bg-[var(--panel-raised)] text-xs font-medium text-[var(--ink-dim)]">
                {accountEmail.charAt(0).toUpperCase() || "?"}
              </div>
              <span
                className="truncate text-xs text-[var(--text-secondary)]"
                title={accountEmail}
              >
                {accountEmail}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 flex-shrink-0">
            {accountEmail !== null && (
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="theme-toggle hit-44 w-9 h-9 flex items-center justify-center"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </form>
            )}
            <button
              onClick={toggleDarkMode}
              className="theme-toggle hit-44 w-9 h-9 flex items-center justify-center"
              aria-label="Toggle theme"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {usage && (
          <Link
            href="/dashboard/settings"
            className="block px-2 pt-2 pb-1 group"
            title="Monthly extractions — manage your plan in Settings"
          >
            <div className="h-1.5 rounded-[2px] bg-[var(--well)] border border-[var(--hairline)] overflow-hidden">
              <div
                className={`h-full ${
                  usage.limit > 0 && usage.used / usage.limit >= 0.8
                    ? "bg-[var(--warn)]"
                    : "bg-[var(--phosphor)]"
                }`}
                style={{
                  width: `${usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0}%`,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)] tabular-nums group-hover:text-[var(--text-secondary)] transition-colors">
              {usage.used.toLocaleString()} / {usage.limit.toLocaleString()} extractions
            </p>
          </Link>
        )}
      </div>
    </aside>
  );
}
