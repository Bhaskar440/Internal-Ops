"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { updateVentureAction } from "@/app/(admin)/ventures/actions";
import { WEEKDAYS } from "@/modules/ventures/venture.schema";

export type VentureSettings = {
  id: string;
  slug: string;
  name: string;
  tagColor: string;
  timezone: string;
  workingDays: number[];
  dailyLogEditWindowHours: number;
  defaultCurrency: string;
  /** Timezone is fixed once time has been recorded against the venture. */
  timezoneLocked: boolean;
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="px-2 py-1 text-xs">
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

const CELL = "py-2.5 pr-4 text-zinc-600 dark:text-zinc-400";
const FIELD =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

/**
 * One venture's settings, editable in place.
 *
 * The page previously showed these values with an Edit link to another screen,
 * which made a settings page that could not change any setting. Editing here
 * keeps the comparison between ventures visible while you change one.
 */
export function VentureSettingsRow({ venture }: { venture: VentureSettings }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(updateVentureAction, {});

  // The action returns {} on success; closing on that keeps the row from
  // staying open after a save that worked.
  const savedCleanly = editing && !state.error && !state.fieldErrors;

  if (!editing) {
    return (
      <tr className="border-b border-zinc-200 dark:border-zinc-800">
        <td className="py-2.5 pr-4">
          <span className="inline-flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: venture.tagColor }}
              aria-hidden
            />
            <Link
              href={`/ventures/${venture.slug}`}
              className="text-zinc-900 hover:underline dark:text-zinc-100"
            >
              {venture.name}
            </Link>
          </span>
        </td>
        <td className={CELL}>{venture.timezone}</td>
        <td className={CELL}>
          {venture.workingDays
            .map((d) => WEEKDAYS.find((w) => w.value === d)?.label)
            .join(" ")}
        </td>
        <td className={`${CELL} tabular-nums`}>{venture.dailyLogEditWindowHours}h</td>
        <td className={CELL}>{venture.defaultCurrency}</td>
        <td className="py-2.5 text-right">
          <Button
            type="button"
            variant="secondary"
            className="px-2 py-1 text-xs"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-zinc-200 bg-blue-50/40 dark:border-zinc-800 dark:bg-blue-950/10">
      <td colSpan={6} className="py-3">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="id" value={venture.id} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs text-zinc-600 dark:text-zinc-400">
              Name
              <input name="name" defaultValue={venture.name} required className={`mt-1 ${FIELD}`} />
            </label>

            <label className="block text-xs text-zinc-600 dark:text-zinc-400">
              Timezone
              <input
                name="timezone"
                defaultValue={venture.timezone}
                disabled={venture.timezoneLocked}
                className={`mt-1 ${FIELD} disabled:cursor-not-allowed disabled:opacity-60`}
              />
              {venture.timezoneLocked && (
                <span className="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-500">
                  Fixed: time is already recorded against this venture.
                </span>
              )}
            </label>

            <label className="block text-xs text-zinc-600 dark:text-zinc-400">
              Daily log cutoff (hours)
              <input
                name="dailyLogEditWindowHours"
                type="number"
                min={1}
                max={720}
                defaultValue={venture.dailyLogEditWindowHours}
                className={`mt-1 ${FIELD}`}
              />
            </label>

            <label className="block text-xs text-zinc-600 dark:text-zinc-400">
              Currency
              <input
                name="defaultCurrency"
                defaultValue={venture.defaultCurrency}
                maxLength={3}
                className={`mt-1 ${FIELD} uppercase`}
              />
            </label>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              Working week
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <label
                  key={d.value}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-300 px-2 py-1 text-xs has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:border-zinc-700 dark:has-[:checked]:bg-blue-950/40"
                >
                  <input
                    type="checkbox"
                    name="workingDays"
                    value={d.value}
                    defaultChecked={venture.workingDays.includes(d.value)}
                    className="h-3 w-3 accent-blue-600"
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>

          {state.error && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {state.error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Save />
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setEditing(false)}
            >
              {savedCleanly ? "Close" : "Cancel"}
            </Button>
          </div>
        </form>
      </td>
    </tr>
  );
}
