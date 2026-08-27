"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireGlobal } from "@/lib/permissions/guard";
import {
  createRun,
  generateLines,
  lockRun,
  voidRun,
  markLinePaid,
  monthPeriod,
} from "@/modules/payroll/payroll.service";
import { setAgreement } from "@/modules/compensation/compensation.service";
import { isAppError } from "@/lib/errors/appError";

export type PayrollFormState = { error?: string };

export async function createRunAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  let runId: string;
  try {
    const actor = await requireGlobal("payroll:generate");

    const year = Number(formData.get("year"));
    const month = Number(formData.get("month"));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return { error: "Choose a valid month." };
    }

    const period = monthPeriod(year, month);
    const run = await createRun(actor, {
      periodStart: period.start,
      periodEnd: period.end,
    });
    runId = run.id;
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Could not create the payroll run." };
  }

  revalidatePath("/payroll");
  redirect(`/payroll/${runId}`);
}

export async function generateLinesAction(formData: FormData): Promise<void> {
  const actor = await requireGlobal("payroll:generate");
  const runId = String(formData.get("runId"));
  await generateLines(actor, runId);
  revalidatePath(`/payroll/${runId}`);
  revalidatePath("/payroll");
}

export async function lockRunAction(formData: FormData): Promise<void> {
  const actor = await requireGlobal("payroll:lock");
  const runId = String(formData.get("runId"));
  await lockRun(actor, runId);
  revalidatePath(`/payroll/${runId}`);
  revalidatePath("/payroll");
}

export async function voidRunAction(formData: FormData): Promise<void> {
  const actor = await requireGlobal("payroll:lock");
  const runId = String(formData.get("runId"));
  await voidRun(actor, runId, String(formData.get("reason") ?? ""));
  revalidatePath(`/payroll/${runId}`);
  revalidatePath("/payroll");
}

export async function markPaidAction(formData: FormData): Promise<void> {
  const actor = await requireGlobal("payroll:mark-paid");
  const lineId = String(formData.get("lineId"));
  const runId = String(formData.get("runId"));
  await markLinePaid(actor, lineId, String(formData.get("reference") ?? "") || undefined);
  revalidatePath(`/payroll/${runId}`);
}

export async function setCompensationAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  try {
    const actor = await requireGlobal("compensation:write");

    const rate = Number(formData.get("rate"));
    if (!Number.isFinite(rate) || rate <= 0) {
      return { error: "Enter a rate greater than zero." };
    }

    await setAgreement(actor, {
      personId: String(formData.get("personId")),
      payType: String(formData.get("payType")) as "HOURLY" | "MONTHLY_FIXED" | "PER_TASK",
      currency: String(formData.get("currency")),
      rate,
      effectiveFrom: String(formData.get("effectiveFrom")),
      prorationPolicy: String(formData.get("prorationPolicy") ?? "FIXED_FULL") as
        | "FIXED_FULL"
        | "ATTENDANCE_PRORATED",
    });

    revalidatePath(`/people/${String(formData.get("personId"))}`);
    return {};
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Could not save the pay agreement." };
  }
}
