import { redirect } from "next/navigation";

// UI-2 U1: schedules now live as a tab of /dashboard/runs. This stub keeps
// old bookmarks/links working; the detail route (/dashboard/schedules/[id])
// stays.
export default function SchedulesRedirect() {
  redirect("/dashboard/runs?tab=schedules");
}
