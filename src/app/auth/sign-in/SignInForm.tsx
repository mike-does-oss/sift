"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInWithEmail } from "./actions";

export function SignInForm() {
  const [state, formAction, isPending] = useActionState(signInWithEmail, null);

  return (
    <>
      <h1 className="font-display text-xl text-[var(--text-primary)] mb-1">Sign in</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-6">
        Welcome back — pick up where you left off.
      </p>

      <form action={formAction} className="space-y-3">
        <div>
          <label htmlFor="email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full px-3 py-2 rounded-lg input-base text-sm"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full px-3 py-2 rounded-lg input-base text-sm"
          />
        </div>

        {state?.error && (
          <p className="text-sm text-[var(--error)]" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full px-4 py-2 rounded-lg btn-primary text-sm"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-[var(--text-secondary)]">
        New to Sift?{" "}
        <Link href="/auth/sign-up" className="text-[var(--accent)] hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
