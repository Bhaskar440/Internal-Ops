"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Hint } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Card";
import { setCompensationAction, type PayrollFormState } from "@/app/(admin)/payroll/actions";

export type AgreementView = {
  id: string;
  payType: string;
  currency: string;
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  prorationPolicy: string;
  isCurrent: boolean;
};

const PAY_TYPES = [
  { value: "HOURLY", label: "Hourly" },
  { value: "MONTHLY_FIXED", label: "Monthly salary" },
  { value: "PER_TASK", label: "Per task" },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save agreement"}
    </Button>
  );
}

/**
 * Compensation panel — rendered only for Super Admins, and only after the
 * server has already decided the caller may see pay. The data never reaches
 * anyone else, so this is presentation, not the access control itself.
 */
export function CompensationPanel({
  personId,
  agreements,
  defaultCurrency,
}: {
  personId: string;
  agreements: AgreementView[];
  defaultCurrency: string;
}) {
  const [state, formAction] = useActionState<PayrollFormState, FormData>(
    setCompensationAction,
    {},
  );
  const [showForm, setShowForm] = useState(agreements.length === 0);
  const [payType, setPayType] = useState("HOURLY");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium text-zinc-900 dark:text-zinc-100">Compensation</h2>
        <Button variant="ghost" onClick={() => setShowForm((v) => !v)} className="text-xs">
          {showForm ? "Cancel" : "Change rate"}
        </Button>
      </div>

      {agreements.length === 0 ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          No pay agreement yet. Payroll cannot calculate anything for this person until one
          exists.
        </p>
      ) : (
        <ul className="mb-4 space-y-2">
          {agreements.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                {a.currency} {Number(a.rate).toLocaleString()}
              </span>
              <span className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                {a.payType.replace("_", " ").toLowerCase()}
              </span>
              <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
                {a.effectiveFrom} → {a.effectiveTo ?? "ongoing"}
              </span>
              {a.isCurrent && <Badge tone="green">current</Badge>}
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form
          action={formAction}
          className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          <input type="hidden" name="personId" value={personId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="payType">Pay type</Label>
              <Select
                id="payType"
                name="payType"
                value={payType}
                onChange={(e) => setPayType(e.target.value)}
              >
                {PAY_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                name="currency"
                defaultValue={defaultCurrency}
                maxLength={3}
                required
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rate">
                {payType === "HOURLY"
                  ? "Rate per hour"
                  : payType === "MONTHLY_FIXED"
                    ? "Monthly salary"
                    : "Default task fee"}
              </Label>
              <Input id="rate" name="rate" type="number" step="0.01" min="0.01" required />
            </div>
            <div>
              <Label htmlFor="effectiveFrom">Effective from</Label>
              <Input id="effectiveFrom" name="effectiveFrom" type="date" required />
              <Hint>Earlier payroll keeps using the previous rate.</Hint>
            </div>
          </div>

          {payType === "MONTHLY_FIXED" && (
            <div>
              <Label htmlFor="prorationPolicy">If they are away part of the month</Label>
              <Select id="prorationPolicy" name="prorationPolicy" defaultValue="FIXED_FULL">
                <option value="FIXED_FULL">Pay the full salary</option>
                <option value="ATTENDANCE_PRORATED">Prorate by days attended</option>
              </Select>
            </div>
          )}

          {state.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.error}
            </p>
          )}

          <Submit />
        </form>
      )}
    </div>
  );
}
