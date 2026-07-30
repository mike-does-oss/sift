import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--surface-base)] grain-overlay">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
