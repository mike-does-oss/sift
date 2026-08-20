"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpWithEmail } from "./actions";

// Bench grammar: etched field labels, well inputs (input-base — 4px machined
// radius), and the view's ONE phosphor plate on the submit action.
export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpWithEmail, null);

  return (
    <>
      <h1 className="font-display mb-1 text-xl text-[var(--ink)]">Create your account</h1>
      <p className="mb-6 text-sm text-[var(--ink-dim)]">
        Start sifting structured data out of your documents.
      </p>

      <form action={formAction} className="space-y-3.5">
        <div>
          <label htmlFor="name" className="etched-label mb-1.5 block">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className="input-base w-full px-3 py-2 text-sm"
          />
        </div>
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
            autoComplete="new-password"
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
          {isPending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-sm text-[var(--ink-dim)]">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="text-[var(--phosphor)] hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
