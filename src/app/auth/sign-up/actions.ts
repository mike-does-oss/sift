"use server";

import { notFound, redirect } from "next/navigation";
import { isHosted } from "@/lib/profile";

export type SignUpState = { error: string } | null;

export async function signUpWithEmail(
  _prevState: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  if (!isHosted()) notFound();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");

  // Dynamic import: the Neon Auth SDK never loads on the local profile.
  const { getAuth } = await import("@/lib/auth/server");
  const { error } = await getAuth().signUp.email({ email, password, name });
  if (error) {
    return { error: error.message || "Failed to create account" };
  }
  redirect("/dashboard");
}
