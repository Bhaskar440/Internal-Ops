"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { LiveElapsed } from "@/components/ui/LiveElapsed";
import { formatMinutes } from "@/lib/money/efficiency";
import {
  stopTimerAction,
  saveManualEntryAction,
  deleteEntryAction,
  updateLogAction,
  submitLogAction,
} from "@/app/(admin)/my-day/actions";

export type DayEntry = {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  source: string;
  durationMinutes: number;
  note: string | null;
  running: boolean;
  /** ISO timestamp; used to tick a running timer in the browser. */
  startedAt: string;
  approvalStatus: string;
};

export type DaySection = {
  logId: string;
  ventureId: string;
  ventureName: string;
  ventureTagColor: string;
  businessDate: string;
  attendanceStatus: string;
  status: string;
  generalNote: string | null;
  totalMinutes: number;
  editable: boolean;
  attendanceConflict: boolean;
  /** Set when a manager sent the day back; shown so it can be corrected. */
  rejectionReason: string | null;
  /** ISO timestamp after which the employee can no longer edit this day. */
  editWindowClosesAt: string;
  entries: DayEntry[];
  tasks: { id: string; title: string }[];
};

const ATTENDANCE = [
  { value: "PRESENT", label: "Present" },
  { value: "REMOTE", label: "Remote" },
  { value: "ON_LEAVE", label: "On leave" },
  { value: "ABSENT", label: "Absent" },
];

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  DRAFT: "neutral",
  SUBMITTED: "blue",
  APPROVED: "green",
  REJECTED: "red",
  LOCKED: "neutral",
};

export function DayVentureSection({
  section,
  hasRunningTimer,
}: {
  section: DaySection;
  hasRunningTimer: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showManual, setShowManual] = useState(false);

  const locked = !section.editable;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "That did not work.");
    });
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: section.ventureTagColor }}
          aria-hidden
        />
        <h2 className="flex-1 font-medium text-zinc-900 dark:text-zinc-100">
          {section.ventureName}
        </h2>
        <span className="tabular-nums text-sm text-zinc-600 dark:text-zinc-400">
          {formatMinutes(section.totalMinutes)}
        </span>
        <Badge tone={STATUS_TONE[section.status] ?? "neutral"}>
          {section.status.toLowerCase()}
        </Badge>
      </header>

      <div className="space-y-4 p-5">
        {section.attendanceConflict && (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            Attendance is marked as away, but hours are logged. Fix one or the other before
            submitting.
          </div>
        )}

        {section.status === "REJECTED" && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            Returned by your manager. Make the changes and submit again.
            {/* rejectLog requires a reason; showing it is the point of asking. */}
            {section.rejectionReason && (
              <p className="mt-1 font-medium">{section.rejectionReason}</p>
            )}
          </div>
        )}

        {/* Attendance + note */}
        <form action={updateLogAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="logId" value={section.logId} />
          <div>
            <label
              htmlFor={`att-${section.logId}`}
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Attendance
            </label>
            <select
              id={`att-${section.logId}`}
              name="attendanceStatus"
              defaultValue={section.attendanceStatus}
              disabled={locked}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
            >
              {ATTENDANCE.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label
              htmlFor={`note-${section.logId}`}
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Note for the day (optional)
            </label>
            <input
              id={`note-${section.logId}`}
              name="generalNote"
              defaultValue={section.generalNote ?? ""}
              disabled={locked}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
            />
          </div>
          {!locked && (
            <Button variant="secondary" type="submit">
              Save
            </Button>
          )}
        </form>

        {/* Entries */}
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Time entries
          </h3>
          {section.entries.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              No time recorded yet today.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {section.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {e.taskTitle ?? "General work"}
                    </span>
                    {e.note && (
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {e.note}
                      </span>
                    )}
                  </span>

                  {e.source === "TIMER" && <Badge>timer</Badge>}
                  {e.approvalStatus === "NEEDS_REVIEW" && <Badge tone="amber">needs review</Badge>}

                  <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                    {e.running ? (
                      <LiveElapsed
                        startedAt={e.startedAt}
                        className="font-medium text-green-700 dark:text-green-400"
                      />
                    ) : (
                      formatMinutes(e.durationMinutes)
                    )}
                  </span>

                  {!locked && !e.running && e.source !== "TIMER" && (
                    <form action={deleteEntryAction}>
                      <input type="hidden" name="entryId" value={e.id} />
                      <input type="hidden" name="ventureId" value={section.ventureId} />
                      <Button
                        variant="ghost"
                        type="submit"
                        className="px-2 py-1 text-xs text-red-600 dark:text-red-400"
                      >
                        Remove
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {/*
          A read-only day previously just showed no buttons, which reads as
          broken rather than as a rule. Say which rule, and what to do next.
        */}
        {locked && <LockedNotice section={section} />}

        {/* Actions */}
        {!locked && (
          <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {/*
              The day is a timesheet: hours are typed against a task, submitted,
              and approved. The timer remains in the service layer and still
              stops a running one, so a timer started before this change can be
              closed out, but it is no longer offered as a way to record time.
            */}
            {hasRunningTimer && (
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => run(() => stopTimerAction())}
              >
                Stop running timer
              </Button>
            )}

            <Button onClick={() => setShowManual((v) => !v)}>
              {showManual ? "Cancel" : "Add hours"}
            </Button>

            <div className="flex-1" />

            <Button
              variant="secondary"
              disabled={pending || section.totalMinutes === 0}
              onClick={() => run(() => submitLogAction(section.logId))}
            >
              Submit day for review
            </Button>
          </div>
        )}

        {showManual && !locked && (
          <ManualEntryForm section={section} onDone={() => setShowManual(false)} />
        )}
      </div>
    </section>
  );
}

function ManualEntryForm({
  section,
  onDone,
}: {
  section: DaySection;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
      action={(formData: FormData) => {
        setError(null);
        startTransition(async () => {
          const result = await saveManualEntryAction({ ok: true }, formData);
          if (result.ok) onDone();
          else setError(result.error ?? "Could not save the entry.");
        });
      }}
    >
      <input type="hidden" name="ventureId" value={section.ventureId} />
      <input type="hidden" name="businessDate" value={section.businessDate} />

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label
            htmlFor={`task-${section.logId}`}
            className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Task
          </label>
          <select
            id={`task-${section.logId}`}
            name="taskId"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">General work (no task)</option>
            {section.tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={`h-${section.logId}`}
            className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Hours
          </label>
          <input
            id={`h-${section.logId}`}
            name="hours"
            type="number"
            min="0"
            max="24"
            defaultValue="0"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label
            htmlFor={`m-${section.logId}`}
            className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Minutes
          </label>
          <input
            id={`m-${section.logId}`}
            name="minutes"
            type="number"
            min="0"
            max="59"
            step="5"
            defaultValue="0"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </div>

      <div className="mt-3">
        <label
          htmlFor={`n-${section.logId}`}
          className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
        >
          Note (optional)
        </label>
        <input
          id={`n-${section.logId}`}
          name="note"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="What did you work on?"
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add entry"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Why this day cannot be edited, and what to do about it.
 *
 * Four different situations lock a day, and they call for different actions:
 * waiting on a manager, already approved, already paid, or past the cutoff.
 * Collapsing them into one message would leave someone stuck on the only one
 * they can actually resolve.
 */
function LockedNotice({ section }: { section: DaySection }) {
  const windowClosed = new Date(section.editWindowClosesAt) < new Date();

  const { tone, title, body } = (() => {
    switch (section.status) {
      case "SUBMITTED":
        return {
          tone: "blue" as const,
          title: "Waiting for approval",
          body: "This day is with your manager. You cannot change it while they are reviewing it — ask them to send it back if something is wrong.",
        };
      case "APPROVED":
        return {
          tone: "green" as const,
          title: "Approved",
          body: "These hours are approved and now count towards reporting. A manager can still correct them, which is recorded in the audit log.",
        };
      case "LOCKED":
        return {
          tone: "neutral" as const,
          title: "Locked by payroll",
          body: "This day is part of a locked payroll run and can no longer change. A correction has to be raised as a payroll adjustment instead.",
        };
      default:
        return windowClosed
          ? {
              tone: "amber" as const,
              title: "The editing window has closed",
              body: "Too much time has passed since this day for you to change it yourself. Ask a manager to record the correction for you.",
            }
          : {
              tone: "neutral" as const,
              title: "This day is read-only",
              body: "It cannot be edited at the moment.",
            };
    }
  })();

  const STYLES = {
    blue: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200",
    green:
      "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200",
    amber:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
    neutral:
      "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  };

  return (
    <div className={`mt-4 rounded-md border px-3 py-2.5 text-sm ${STYLES[tone]}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 opacity-90">{body}</p>
      {section.rejectionReason && (
        <p className="mt-1.5 opacity-90">
          <span className="font-medium">Manager&rsquo;s note:</span> {section.rejectionReason}
        </p>
      )}
    </div>
  );
}
