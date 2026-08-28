"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Hint, FieldError } from "@/components/ui/Field";
import { EMPLOYMENT_TYPES, ACCESS_ROLES } from "@/modules/people/person.schema";
import type { PersonFormState } from "@/app/(admin)/people/actions";

type Action = (prev: PersonFormState, formData: FormData) => Promise<PersonFormState>;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create person"}
    </Button>
  );
}

export function PersonForm({
  action,
  ventures,
}: {
  action: Action;
  ventures: { id: string; name: string; tagColor: string }[];
}) {
  const [state, formAction] = useActionState<PersonFormState, FormData>(action, {});
  const [copied, setCopied] = useState(false);

  // Success. The link is always shown: as the delivery method when email is not
  // configured, and as a backup when it is.
  if (state.inviteUrl) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-green-300 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
          <p className="font-medium text-green-900 dark:text-green-200">Person created</p>
          <p className="mt-1 text-sm text-green-800 dark:text-green-300">
            {state.emailSent
              ? "An invitation email is on its way. Their account is pending until they set a password."
              : "Their account is pending until they set a password using this invitation link."}{" "}
            The link expires in 7 days.
          </p>
        </div>

        <div>
          <Label htmlFor="invite">Invitation link</Label>
          <div className="flex gap-2">
            <Input id="invite" readOnly value={state.inviteUrl} className="font-mono text-xs" />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.inviteUrl!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Hint>
            {state.emailSent
              ? "Kept here as a backup in case the email does not arrive."
              : "Email delivery is not configured, so send this to them yourself."}
          </Hint>
        </div>

        <div className="flex gap-2">
          <Link href="/people">
            <Button variant="secondary">Back to people</Button>
          </Link>
          <Link href="/people/new">
            <Button>Add another</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" required autoFocus placeholder="Neha Mehta" />
          <FieldError>{state.fieldErrors?.name}</FieldError>
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="neha@company.com"
          />
          <FieldError>{state.fieldErrors?.email}</FieldError>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input id="phone" name="phone" placeholder="+91 98765 43210" />
          <FieldError>{state.fieldErrors?.phone}</FieldError>
        </div>
        <div>
          <Label htmlFor="startDate">Start date (optional)</Label>
          <Input id="startDate" name="startDate" type="date" />
          <FieldError>{state.fieldErrors?.startDate}</FieldError>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="employmentType">Employment type</Label>
          <Select id="employmentType" name="employmentType" defaultValue="EMPLOYEE">
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Hint>How they are paid — separate from what they can access.</Hint>
          <FieldError>{state.fieldErrors?.employmentType}</FieldError>
        </div>
        <div>
          <Label htmlFor="accessRole">Access role in selected ventures</Label>
          <Select id="accessRole" name="accessRole" defaultValue="MEMBER">
            {ACCESS_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <Hint>Managers can assign people and approve daily logs in that venture.</Hint>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Ventures
        </legend>
        {ventures.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No ventures yet — you can assign them later.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ventures.map((v) => (
              <label
                key={v.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:border-zinc-700 dark:has-[:checked]:bg-blue-950/40"
              >
                <input
                  type="checkbox"
                  name="ventureIds"
                  value={v.id}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: v.tagColor }}
                  aria-hidden
                />
                {v.name}
              </label>
            ))}
          </div>
        )}
        <Hint>A person can belong to more than one venture.</Hint>
      </fieldset>

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      <div className="flex gap-2">
        <Submit />
        <Link href="/people">
          <Button variant="secondary" type="button">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
