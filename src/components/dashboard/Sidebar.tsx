"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  Layers,
  CalendarClock,
  FileJson,
  Database,
  History,
  Settings,
  Moon,
  Sun,
  LogOut,
} from "lucide-react";
import { signOutAction } from "@/app/dashboard/actions";
import { SiftWordmark } from "@/components/brand/SiftWordmark";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Extract", icon: Sparkles },
  { href: "/dashboard/batches", label: "Batches", icon: Layers },
  { href: "/dashboard/schedules", label: "Schedules", icon: CalendarClock },
  { href: "/dashboard/templates", label: "Templates", icon: FileJson },
  { href: "/dashboard/datasets", label: "Datasets", icon: Database },
  { href: "/dashboard/history", label: "History", icon: History },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

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
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const isDark =
      stored === "dark" ||
      (stored === null && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
    // Correcting from an external system (localStorage/matchMedia) post-hydration is intentional here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDarkMode(isDark);
  }, []);

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
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
          const isActive =
            item.href === "/dashboard"
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
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
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-xs font-medium text-[var(--accent)]">
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
                  className="theme-toggle w-9 h-9 rounded-lg flex items-center justify-center"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </form>
            )}
            <button
              onClick={toggleDarkMode}
              className="theme-toggle w-9 h-9 rounded-lg flex items-center justify-center"
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
            <div className="h-1.5 rounded-full bg-[var(--surface-overlay)] overflow-hidden">
              <div
                className={`h-full ${
                  usage.limit > 0 && usage.used / usage.limit >= 0.8
                    ? "bg-[var(--error)]"
                    : "bg-[var(--accent)]"
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
