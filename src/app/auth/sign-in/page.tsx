import { notFound } from "next/navigation";
import { isHosted } from "@/lib/profile";
import { AuthShell } from "../AuthShell";
import { SignInForm } from "./SignInForm";

// Hosted-only surface: on the local profile there is no auth, so this page
// (like /api/auth/*) must not exist.
export default function SignInPage() {
  if (!isHosted()) notFound();
  return (
    <AuthShell>
      <SignInForm />
    </AuthShell>
  );
}
