"use server";

import { notFound, redirect } from "next/navigation";
import { isHosted } from "@/lib/profile";

export type SignInState = { error: string } | null;

export async function signInWithEmail(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  if (!isHosted()) notFound();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  // Dynamic import: the Neon Auth SDK never loads on the local profile.
  const { getAuth } = await import("@/lib/auth/server");
  const { error } = await getAuth().signIn.email({ email, password });
  if (error) {
    return { error: error.message || "Failed to sign in" };
  }
  redirect("/dashboard");
}
