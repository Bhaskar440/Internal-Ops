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
  createAdjustment,
  cancelAdjustment,
  monthPeriod,
} from "@/modules/payroll/payroll.service";
import { setAgreement } from "@/modules/compensation/compensation.service";
import { isAppError } from "@/lib/errors/appError";
import { dateString } from "@/lib/validation/dateString";

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

    // effectiveFrom decides which rate a payroll run uses, so a malformed or
    // absurd date here would misprice someone's pay.
    const effectiveFrom = dateString.safeParse(formData.get("effectiveFrom"));
    if (!effectiveFrom.success) {
      return { error: effectiveFrom.error.issues[0]?.message ?? "Check the effective date." };
    }

    await setAgreement(actor, {
      personId: String(formData.get("personId")),
      payType: String(formData.get("payType")) as "HOURLY" | "MONTHLY_FIXED" | "PER_TASK",
      currency: String(formData.get("currency")),
      rate,
      effectiveFrom: effectiveFrom.data,
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

/**
 * Raise a correction against already-paid payroll (§43). It settles into the
 * person's next run rather than altering the run that was paid.
 */
export async function createAdjustmentAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  try {
    const actor = await requireGlobal("payroll:mark-paid");

    const amount = Number(formData.get("amount"));
    if (!Number.isFinite(amount) || amount === 0) {
      return { error: "Enter an amount other than zero." };
    }

    await createAdjustment(actor, {
      personId: String(formData.get("personId")),
      sourcePayrollLineId: String(formData.get("sourcePayrollLineId") ?? "") || undefined,
      amount,
      currency: String(formData.get("currency") ?? "INR"),
      reason: String(formData.get("reason") ?? ""),
    });

    revalidatePath("/payroll");
    revalidatePath("/payroll/adjustments");
    return {};
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Could not record the adjustment." };
  }
}

export async function cancelAdjustmentAction(formData: FormData): Promise<void> {
  const actor = await requireGlobal("payroll:mark-paid");
  await cancelAdjustment(
    actor,
    String(formData.get("adjustmentId")),
    String(formData.get("reason") ?? ""),
  );
  revalidatePath("/payroll/adjustments");
}
