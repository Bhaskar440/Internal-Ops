"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Hint, FieldError } from "@/components/ui/Field";
import {
  COMMON_TIMEZONES,
  COMMON_CURRENCIES,
  WEEKDAYS,
} from "@/modules/ventures/venture.schema";
import type { FormState } from "@/app/(admin)/ventures/actions";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type VentureFormValues = {
  id?: string;
  name?: string;
  slug?: string;
  timezone?: string;
  tagColor?: string;
  workingDays?: number[];
  dailyLogEditWindowHours?: number;
  defaultCurrency?: string;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function VentureForm({
  action,
  initial = {},
  submitLabel,
  timezoneLocked = false,
}: {
  action: Action;
  initial?: VentureFormValues;
  submitLabel: string;
  timezoneLocked?: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.slug));
  const isEdit = Boolean(initial.id);
  const days = initial.workingDays ?? [1, 2, 3, 4, 5];

  return (
    <form action={formAction} className="space-y-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <div>
        <Label htmlFor="name">Venture name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={initial.name}
          placeholder="Norvik Gold"
          onChange={(e) => {
            if (!slugTouched) {
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, ""),
              );
            }
          }}
        />
        <FieldError>{state.fieldErrors?.name}</FieldError>
      </div>

      {!isEdit && (
        <div>
          <Label htmlFor="slug">URL slug</Label>
          <Input
            id="slug"
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="norvik-gold"
          />
          <Hint>Used in links. Lowercase letters, numbers and hyphens.</Hint>
          <FieldError>{state.fieldErrors?.slug}</FieldError>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="timezone">Business timezone</Label>
          <Select
            id="timezone"
            name="timezone"
            defaultValue={initial.timezone ?? "Asia/Kolkata"}
            disabled={timezoneLocked}
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
          <Hint>
            {timezoneLocked
              ? "Locked: this venture already has recorded time, and changing the zone would reinterpret historical dates."
              : "Determines business days and daily-log cutoffs."}
          </Hint>
          <FieldError>{state.fieldErrors?.timezone}</FieldError>
        </div>

        <div>
          <Label htmlFor="defaultCurrency">Default currency</Label>
          <Select
            id="defaultCurrency"
            name="defaultCurrency"
            defaultValue={initial.defaultCurrency ?? "INR"}
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <FieldError>{state.fieldErrors?.defaultCurrency}</FieldError>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Working days
        </legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <label
              key={d.value}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:border-zinc-700 dark:has-[:checked]:bg-blue-950/40"
            >
              <input
                type="checkbox"
                name="workingDays"
                value={d.value}
                defaultChecked={days.includes(d.value)}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              {d.label}
            </label>
          ))}
        </div>
        <FieldError>{state.fieldErrors?.workingDays}</FieldError>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="dailyLogEditWindowHours">Daily-log edit window (hours)</Label>
          <Input
            id="dailyLogEditWindowHours"
            name="dailyLogEditWindowHours"
            type="number"
            min={0}
            max={720}
            required
            defaultValue={initial.dailyLogEditWindowHours ?? 48}
          />
          <Hint>How long after a business day an employee may still edit their log.</Hint>
          <FieldError>{state.fieldErrors?.dailyLogEditWindowHours}</FieldError>
        </div>

        <div>
          <Label htmlFor="tagColor">Tag colour</Label>
          <input
            id="tagColor"
            name="tagColor"
            type="color"
            defaultValue={initial.tagColor ?? "#2563eb"}
            className="h-10 w-20 cursor-pointer rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      <Submit label={submitLabel} />
    </form>
  );
}
