"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Hint, FieldError } from "@/components/ui/Field";
import { TASK_PRIORITIES } from "@/modules/tasks/task.schema";
import type { TaskFormState } from "@/app/(admin)/tasks/actions";

type Action = (prev: TaskFormState, formData: FormData) => Promise<TaskFormState>;

export type VentureOption = {
  id: string;
  name: string;
  tagColor: string;
  defaultCurrency: string;
  members: { personId: string; name: string }[];
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function TaskForm({
  action,
  ventures,
  submitLabel,
  initial,
}: {
  action: Action;
  ventures: VentureOption[];
  submitLabel: string;
  initial?: {
    taskId?: string;
    ventureId?: string;
    title?: string;
    description?: string;
    estimatedHours?: number;
    priority?: string;
    dueDate?: string;
    assigneeIds?: string[];
  };
}) {
  const [state, formAction] = useActionState<TaskFormState, FormData>(action, {});

  // After a failed submit the server echoes back what was typed, so nothing is
  // lost. On a fresh form there is nothing echoed and `initial` is used.
  const kept = state.values;
  const keptText = (field: string, fallback?: string | number) =>
    typeof kept?.[field] === "string" ? (kept[field] as string) : (fallback ?? "");
  const keptChecked = (personId: string, fallback: boolean) =>
    Array.isArray(kept?.assigneeIds)
      ? (kept.assigneeIds as string[]).includes(personId)
      : fallback;
  const [ventureId, setVentureId] = useState(initial?.ventureId ?? ventures[0]?.id ?? "");
  const [showFee, setShowFee] = useState(false);

  const venture = ventures.find((v) => v.id === ventureId);
  const isEdit = Boolean(initial?.taskId);

  return (
    <form action={formAction} className="space-y-5">
      {initial?.taskId && <input type="hidden" name="taskId" value={initial.taskId} />}
      {isEdit && <input type="hidden" name="ventureId" value={ventureId} />}

      {!isEdit && (
        <div>
          <Label htmlFor="ventureId">Venture</Label>
          <Select
            id="ventureId"
            name="ventureId"
            required
            value={ventureId}
            onChange={(e) => setVentureId(e.target.value)}
          >
            {ventures.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <FieldError>{state.fieldErrors?.ventureId}</FieldError>
        </div>
      )}

      <div>
        <Label htmlFor="title">Task title</Label>
        <Input
          id="title"
          name="title"
          required
          autoFocus={!isEdit}
          defaultValue={keptText("title", initial?.title)}
          placeholder="Redesign the venture dashboard"
        />
        <FieldError>{state.fieldErrors?.title}</FieldError>
      </div>

      <div>
        <Label htmlFor="description">Description (optional)</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={keptText("description", initial?.description)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          placeholder="What does done look like?"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <Label htmlFor="estimatedHours">Estimated hours *</Label>
          <Input
            id="estimatedHours"
            name="estimatedHours"
            type="number"
            step="0.25"
            min="0.25"
            required
            defaultValue={keptText("estimatedHours", initial?.estimatedHours)}
            placeholder="8"
          />
          <Hint>Required. Efficiency is measured against this.</Hint>
          <FieldError>{state.fieldErrors?.estimatedHours}</FieldError>
        </div>

        <div>
          <Label htmlFor="priority">Priority</Label>
          <Select id="priority" name="priority" defaultValue={keptText("priority", initial?.priority ?? "MEDIUM")}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="dueDate">Due date</Label>
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={keptText("dueDate", initial?.dueDate)}
          />
          <FieldError>{state.fieldErrors?.dueDate}</FieldError>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Assignees
        </legend>
        {!venture || venture.members.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No one is assigned to this venture yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {venture.members.map((m) => (
              <label
                key={m.personId}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:border-zinc-700 dark:has-[:checked]:bg-blue-950/40"
              >
                <input
                  type="checkbox"
                  name="assigneeIds"
                  value={m.personId}
                  defaultChecked={keptChecked(m.personId, Boolean(initial?.assigneeIds?.includes(m.personId)))}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
                {m.name}
              </label>
            ))}
          </div>
        )}
        <Hint>More than one person can work on the same task.</Hint>
      </fieldset>

      {!isEdit && (
        <div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={showFee}
              onChange={(e) => setShowFee(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            This is a fixed-fee task for a freelancer
          </label>

          {showFee && (
            <div className="mt-3 grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="fixedFee">Fixed fee</Label>
                <Input id="fixedFee" name="fixedFee" type="number" step="0.01" min="0.01" />
                <Hint>Payable when the task is done and the fee is approved.</Hint>
              </div>
              <div>
                <Label htmlFor="feeCurrency">Currency</Label>
                <Input
                  id="feeCurrency"
                  name="feeCurrency"
                  defaultValue={venture?.defaultCurrency ?? "INR"}
                  maxLength={3}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      <div className="flex gap-2">
        <Submit label={submitLabel} />
        <Link href="/tasks">
          <Button variant="secondary" type="button">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
