"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acceptInvite, type InviteState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Hint } from "@/components/ui/Field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Setting password…" : "Set password and activate"}
    </Button>
  );
}

export function InviteForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<InviteState, FormData>(
    acceptInvite.bind(null, token),
    {},
  );

  if (state.done) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-xl dark:bg-green-950">
          ✓
        </div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">Account activated</h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          You can now sign in with your email and new password.
        </p>
        <Link href="/login" className="mt-4 inline-block">
          <Button>Go to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          autoFocus
        />
        <Hint>At least 10 characters.</Hint>
      </div>

      <div>
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      <Submit />
    </form>
  );
}
