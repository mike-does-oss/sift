import { redirect } from "next/navigation";

// UI-2 U1: history now lives as a tab of /dashboard/runs. This stub keeps old
// bookmarks/links working.
export default function HistoryRedirect() {
  redirect("/dashboard/runs?tab=history");
}
