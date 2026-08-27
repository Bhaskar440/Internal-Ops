"use server";

import { revalidatePath } from "next/cache";
import { requireActiveActor } from "@/lib/auth/actor";
import { requireVenture } from "@/lib/permissions/guard";
import { startTimer, stopTimer, saveManualEntry, deleteEntry } from "@/modules/time/time.service";
import { submitLog, updateLog, approveLog, rejectLog } from "@/modules/dailyLogs/dailyLog.service";
import { isAppError } from "@/lib/errors/appError";

export type ActionResult = { ok: boolean; error?: string };

function fail(e: unknown, fallback: string): ActionResult {
  return { ok: false, error: isAppError(e) ? e.message : fallback };
}

function revalidateWorkPages() {
  revalidatePath("/my-day");
  revalidatePath("/tasks");
  revalidatePath("/approvals");
  revalidatePath("/");
}

export async function startTimerAction(
  ventureId: string,
  taskId?: string,
): Promise<ActionResult> {
  try {
    const actor = await requireVenture(ventureId, "venture:read");
    await startTimer(actor, { taskId });
    revalidateWorkPages();
    return { ok: true };
  } catch (e) {
    return fail(e, "Could not start the timer.");
  }
}

export async function stopTimerAction(): Promise<ActionResult> {
  try {
    const actor = await requireActiveActor();
    await stopTimer(actor);
    revalidateWorkPages();
    return { ok: true };
  } catch (e) {
    return fail(e, "Could not stop the timer.");
  }
}

export async function saveManualEntryAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ventureId = String(formData.get("ventureId"));
    const businessDate = String(formData.get("businessDate"));
    const hours = Number(formData.get("hours") ?? 0);
    const minutesPart = Number(formData.get("minutes") ?? 0);
    const totalMinutes = Math.round(hours * 60 + minutesPart);

    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
      return { ok: false, error: "Enter how long you worked." };
    }

    const actor = await requireVenture(ventureId, "venture:read");
    const taskId = String(formData.get("taskId") ?? "") || undefined;

    await saveManualEntry(actor, {
      entryId: String(formData.get("entryId") ?? "") || undefined,
      taskId,
      businessDate,
      minutes: totalMinutes,
      note: String(formData.get("note") ?? "") || undefined,
    });

    revalidateWorkPages();
    return { ok: true };
  } catch (e) {
    return fail(e, "Could not save the entry.");
  }
}

export async function deleteEntryAction(formData: FormData): Promise<void> {
  const ventureId = String(formData.get("ventureId"));
  const entryId = String(formData.get("entryId"));
  const actor = await requireVenture(ventureId, "venture:read");
  await deleteEntry(actor, entryId);
  revalidateWorkPages();
}

export async function updateLogAction(formData: FormData): Promise<void> {
  const actor = await requireActiveActor();
  await updateLog(actor, {
    logId: String(formData.get("logId")),
    attendanceStatus: String(formData.get("attendanceStatus")),
    generalNote: String(formData.get("generalNote") ?? ""),
  });
  revalidateWorkPages();
}

export async function submitLogAction(logId: string): Promise<ActionResult> {
  try {
    const actor = await requireActiveActor();
    await submitLog(actor, logId);
    revalidateWorkPages();
    return { ok: true };
  } catch (e) {
    return fail(e, "Could not submit the day.");
  }
}

export async function approveLogAction(formData: FormData): Promise<void> {
  const ventureId = String(formData.get("ventureId"));
  const actor = await requireVenture(ventureId, "dailylog:approve");
  await approveLog(actor, String(formData.get("logId")));
  revalidateWorkPages();
}

export async function rejectLogAction(formData: FormData): Promise<void> {
  const ventureId = String(formData.get("ventureId"));
  const actor = await requireVenture(ventureId, "dailylog:approve");
  await rejectLog(actor, String(formData.get("logId")), String(formData.get("reason") ?? ""));
  revalidateWorkPages();
}
