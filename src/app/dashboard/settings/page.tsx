import { isHosted } from "@/lib/profile";
import LocalSettingsPage from "./LocalSettings";
import HostedSettingsPage from "./HostedSettings";

// §SaaS-1 T6 (plan decision 10): one route, two profiles. Local renders the
// existing provider-configuration page unchanged; hosted renders account /
// plan & usage / BYO key instead — provider config, the Ollama panel, and
// hardware recommendations are hidden entirely there (the hosted provider is
// a billing decision, not a setting).
export default async function SettingsPage() {
  if (!isHosted()) return <LocalSettingsPage />;

  // Dynamic import: the Neon Auth SDK never loads on the local profile. The
  // dashboard layout is already force-dynamic, so reading the session cookie
  // here is fine; middleware guarantees it exists by the time this renders.
  const { getAuth } = await import("@/lib/auth/server");
  const { data: session } = await getAuth().getSession();
  return <HostedSettingsPage email={session?.user.email ?? ""} />;
}
