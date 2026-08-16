import { notFound } from "next/navigation";
import { isHosted } from "@/lib/profile";
import { AuthShell } from "../AuthShell";
import { SignUpForm } from "./SignUpForm";

// Hosted-only surface: on the local profile there is no auth, so this page
// (like /api/auth/*) must not exist.
export default function SignUpPage() {
  if (!isHosted()) notFound();
  return (
    <AuthShell>
      <SignUpForm />
    </AuthShell>
  );
}
