"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Hint } from "@/components/ui/Field";
import { createAdjustmentAction, type PayrollFormState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Recording…" : "Record adjustment"}
    </Button>
  );
}

export function AdjustmentForm({
  people,
  defaultCurrency,
}: {
  people: { personId: string; name: string }[];
  defaultCurrency: string;
}) {
  const [state, formAction] = useActionState<PayrollFormState, FormData>(
    createAdjustmentAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <Label htmlFor="personId">Person</Label>
        <Select id="personId" name="personId" required>
          {people.map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" name="amount" type="number" step="0.01" required placeholder="2500" />
          <Hint>Negative to recover an overpayment.</Hint>
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" defaultValue={defaultCurrency} maxLength={3} required />
        </div>
      </div>

      <div>
        <Label htmlFor="reason">Reason</Label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          required
          placeholder="Missed overtime approved after the run was locked"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <Hint>Recorded in the audit log and shown on the settled run.</Hint>
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
