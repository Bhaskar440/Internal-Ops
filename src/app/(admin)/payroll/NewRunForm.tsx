"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Label, Select } from "@/components/ui/Field";
import { createRunAction, type PayrollFormState } from "./actions";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating…" : "Create run"}
    </Button>
  );
}

export function NewRunForm({
  defaultYear,
  defaultMonth,
}: {
  defaultYear: number;
  defaultMonth: number;
}) {
  const [state, formAction] = useActionState<PayrollFormState, FormData>(
    createRunAction,
    {},
  );

  const years = [defaultYear - 1, defaultYear, defaultYear + 1];

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <Label htmlFor="month">Month</Label>
        <Select id="month" name="month" defaultValue={String(defaultMonth)}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="year">Year</Label>
        <Select id="year" name="year" defaultValue={String(defaultYear)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      <Submit />
    </form>
  );
}
