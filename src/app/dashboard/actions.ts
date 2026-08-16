"use server";

import { notFound, redirect } from "next/navigation";
import { isHosted } from "@/lib/profile";

export async function signOutAction() {
  if (!isHosted()) notFound();
  // Dynamic import: the Neon Auth SDK never loads on the local profile.
  const { getAuth } = await import("@/lib/auth/server");
  await getAuth().signOut();
  redirect("/auth/sign-in");
}
