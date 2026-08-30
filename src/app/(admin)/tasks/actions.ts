"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVenture } from "@/lib/permissions/guard";
import { createTaskSchema, changeStatusSchema, updateTaskSchema } from "@/modules/tasks/task.schema";
import {
  archiveTask,
  deleteTask,
  restoreTask,
  changeTaskStatus,
  createTask,
  updateTask,
} from "@/modules/tasks/task.service";
import { isAppError } from "@/lib/errors/appError";

export type TaskFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  /**
   * What the person typed, echoed back so a validation error does not wipe the
   * form. Without this a single bad field costs them everything they entered.
   */
  values?: Record<string, string | string[]>;
};

/** Capture the submitted fields so they can be restored after a failed submit. */
function submittedValues(formData: FormData): Record<string, string | string[]> {
  return {
    ventureId: String(formData.get("ventureId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    estimatedHours: String(formData.get("estimatedHours") ?? ""),
    priority: String(formData.get("priority") ?? "MEDIUM"),
    dueDate: String(formData.get("dueDate") ?? ""),
    assigneeIds: formData.getAll("assigneeIds").map(String),
  };
}

function collectFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  let ventureId: string;
  try {
    const rawHours = formData.get("estimatedHours");
    const parsed = createTaskSchema.safeParse({
      ventureId: formData.get("ventureId"),
      title: formData.get("title"),
      description: formData.get("description") ?? undefined,
      estimatedHours: rawHours === null || rawHours === "" ? undefined : Number(rawHours),
      priority: formData.get("priority") ?? "MEDIUM",
      dueDate: formData.get("dueDate") ?? undefined,
      assigneeIds: formData.getAll("assigneeIds").map(String).filter(Boolean),
      fixedFee: formData.get("fixedFee") ? Number(formData.get("fixedFee")) : undefined,
      feeCurrency: formData.get("feeCurrency") || undefined,
    });

    if (!parsed.success) {
      return {
        error: "Check the highlighted fields.",
        fieldErrors: collectFieldErrors(parsed.error.issues),
        values: submittedValues(formData),
      };
    }

    const actor = await requireVenture(parsed.data.ventureId, "task:create");
    await createTask(actor, parsed.data);
    ventureId = parsed.data.ventureId;
  } catch (e) {
    return {
      error: isAppError(e) ? e.message : "Could not create the task.",
      values: submittedValues(formData),
    };
  }

  revalidatePath("/tasks");
  revalidatePath("/");
  redirect(`/tasks?venture=${ventureId}`);
}

export async function updateTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  try {
    const ventureId = String(formData.get("ventureId"));
    const rawHours = formData.get("estimatedHours");

    const parsed = updateTaskSchema.safeParse({
      taskId: formData.get("taskId"),
      title: formData.get("title") ?? undefined,
      description: formData.get("description") ?? undefined,
      estimatedHours: rawHours === null || rawHours === "" ? undefined : Number(rawHours),
      priority: formData.get("priority") ?? undefined,
      dueDate: formData.get("dueDate") ?? undefined,
      assigneeIds: formData.getAll("assigneeIds").map(String).filter(Boolean),
    });

    if (!parsed.success) {
      return {
        error: "Check the highlighted fields.",
        fieldErrors: collectFieldErrors(parsed.error.issues),
        values: submittedValues(formData),
      };
    }

    const actor = await requireVenture(ventureId, "task:update");
    await updateTask(actor, parsed.data);

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return {};
  } catch (e) {
    return {
      error: isAppError(e) ? e.message : "Could not update the task.",
      values: submittedValues(formData),
    };
  }
}

/**
 * Move a task between columns. Returns an error string rather than throwing so
 * the board can snap the card back and explain why.
 */
export async function changeStatusAction(
  taskId: string,
  ventureId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const parsed = changeStatusSchema.safeParse({ taskId, status });
    if (!parsed.success) return { ok: false, error: "Unknown status." };

    const actor = await requireVenture(ventureId, "task:update");
    await changeTaskStatus(actor, parsed.data);

    revalidatePath("/tasks");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: isAppError(e) ? e.message : "Could not move the task." };
  }
}

export async function archiveTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId"));
  const ventureId = String(formData.get("ventureId"));
  const reason = String(formData.get("reason") ?? "") || undefined;

  const actor = await requireVenture(ventureId, "task:archive");
  await archiveTask(actor, taskId, reason);

  revalidatePath("/tasks");
  redirect("/tasks");
}

/** Bring an archived task back to the board. */
export async function restoreTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId"));
  const ventureId = String(formData.get("ventureId"));

  const actor = await requireVenture(ventureId, "task:archive");
  await restoreTask(actor, taskId);

  revalidatePath("/tasks");
  redirect("/tasks?archived=1");
}

/**
 * Permanently delete an archived task.
 *
 * Refused when the task has logged time; the message explains why rather than
 * letting a database constraint surface as a 500.
 */
export async function deleteTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId"));
  const ventureId = String(formData.get("ventureId"));

  const actor = await requireVenture(ventureId, "task:archive");

  // redirect() signals by throwing, so it must sit outside the try — calling it
  // inside would have this catch swallow the navigation.
  let failure: string | null = null;
  try {
    await deleteTask(actor, taskId);
  } catch (e) {
    failure = isAppError(e) ? e.message : "Could not delete that task.";
  }

  revalidatePath("/tasks");
  redirect(
    failure
      ? `/tasks?archived=1&error=${encodeURIComponent(failure)}`
      : "/tasks?archived=1",
  );
}
