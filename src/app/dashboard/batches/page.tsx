import { redirect } from "next/navigation";

// UI-2 U1: batches now live as a tab of /dashboard/runs. This stub keeps old
// bookmarks/links working; the detail route (/dashboard/batches/[id]) stays.
export default function BatchesRedirect() {
  redirect("/dashboard/runs?tab=batches");
}
