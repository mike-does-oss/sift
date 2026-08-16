"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpWithEmail } from "./actions";

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpWithEmail, null);

  return (
    <>
      <h1 className="font-display text-xl text-[var(--text-primary)] mb-1">Create your account</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-6">
        Start sifting structured data out of your documents.
      </p>

      <form action={formAction} className="space-y-3">
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className="w-full px-3 py-2 rounded-lg input-base text-sm"
          />
        </div>
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
            autoComplete="new-password"
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
          {isPending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-sm text-[var(--text-secondary)]">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="text-[var(--accent)] hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
