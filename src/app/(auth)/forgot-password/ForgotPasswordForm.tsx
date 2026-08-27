"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestPasswordReset, type ResetRequestState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Hint } from "@/components/ui/Field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Send reset link"}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ResetRequestState, FormData>(
    requestPasswordReset,
    {},
  );

  if (state.sent) {
    return (
      <div>
        <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm dark:border-green-900 dark:bg-green-950/30">
          <p className="font-medium text-green-900 dark:text-green-200">Check your email</p>
          <p className="mt-1 text-green-800 dark:text-green-300">
            If an account exists for that address, a reset link is on its way. It expires in
            an hour.
          </p>
        </div>

        {state.devLink && (
          <div className="mt-4">
            <Label htmlFor="link">Reset link</Label>
            <Input id="link" readOnly value={state.devLink} className="font-mono text-xs" />
            <Hint>
              Email delivery is not configured yet, so the link is shown here for an
              administrator to pass on.
            </Hint>
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@company.com"
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
