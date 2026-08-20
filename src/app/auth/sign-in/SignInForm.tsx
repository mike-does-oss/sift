"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInWithEmail } from "./actions";

// Bench grammar: etched field labels, well inputs (input-base — 4px machined
// radius), and the view's ONE phosphor plate on the submit action.
export function SignInForm() {
  const [state, formAction, isPending] = useActionState(signInWithEmail, null);

  return (
    <>
      <h1 className="font-display mb-1 text-xl text-[var(--ink)]">Sign in</h1>
      <p className="mb-6 text-sm text-[var(--ink-dim)]">
        Welcome back — pick up where you left off.
      </p>

      <form action={formAction} className="space-y-3.5">
        <div>
          <label htmlFor="email" className="etched-label mb-1.5 block">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="input-base w-full px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="password" className="etched-label mb-1.5 block">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input-base w-full px-3 py-2 text-sm"
          />
        </div>

        {state?.error && (
          <p className="text-sm text-[var(--fault)]" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="btn-primary w-full px-4 py-2 text-sm"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-[var(--ink-dim)]">
        New to Sift?{" "}
        <Link href="/auth/sign-up" className="text-[var(--phosphor)] hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
