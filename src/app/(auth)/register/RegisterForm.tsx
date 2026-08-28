"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { register, type RegisterState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Hint, FieldError } from "@/components/ui/Field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Submitting…" : "Request access"}
    </Button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState<RegisterState, FormData>(register, {});

  if (state.done) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-xl dark:bg-amber-950">
          &#8987;
        </div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
          Registration received
        </h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          An administrator will review your details and assign your ventures. You can sign
          in once your account is approved.
        </p>
        <Link href="/login" className="mt-4 inline-block">
          <Button variant="secondary">Go to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" required autoFocus autoComplete="name" />
        <FieldError>{state.fieldErrors?.name}</FieldError>
      </div>

      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="username" />
        <FieldError>{state.fieldErrors?.email}</FieldError>
      </div>

      <div>
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" name="phone" autoComplete="tel" />
      </div>

      <div>
        <Label htmlFor="employmentType">How will you be engaged?</Label>
        <Select id="employmentType" name="employmentType" defaultValue="FREELANCER">
          <option value="FREELANCER">Freelancer</option>
          <option value="CONTRACTOR">Contractor</option>
        </Select>
        <Hint>Your rate is set by an administrator, not here.</Hint>
        <FieldError>{state.fieldErrors?.employmentType}</FieldError>
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
        <Hint>At least 10 characters.</Hint>
        <FieldError>{state.fieldErrors?.password}</FieldError>
      </div>

      <div>
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
        />
        <FieldError>{state.fieldErrors?.confirm}</FieldError>
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
