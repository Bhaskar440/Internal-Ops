"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireGlobal } from "@/lib/permissions/guard";
import { createVentureSchema, updateVentureSchema } from "@/modules/ventures/venture.schema";
import {
  archiveVenture,
  createVenture,
  updateVenture,
} from "@/modules/ventures/venture.service";
import { isAppError } from "@/lib/errors/appError";

export type FormState = { error?: string; fieldErrors?: Record<string, string> };

function parseWorkingDays(formData: FormData): number[] {
  return formData.getAll("workingDays").map((d) => Number(d)).filter((n) => Number.isInteger(n));
}

/** Create a venture. Authorization happens BEFORE validation (§51). */
export async function createVentureAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let slug: string;
  try {
    const actor = await requireGlobal("venture:create");

    const parsed = createVentureSchema.safeParse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      timezone: formData.get("timezone"),
      tagColor: formData.get("tagColor") || "#2563eb",
      workingDays: parseWorkingDays(formData),
      dailyLogEditWindowHours: Number(formData.get("dailyLogEditWindowHours")),
      defaultCurrency: formData.get("defaultCurrency"),
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      return { error: "Check the highlighted fields.", fieldErrors };
    }

    const venture = await createVenture(actor, parsed.data);
    slug = venture.slug;
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Could not create the venture." };
  }

  revalidatePath("/ventures");
  revalidatePath("/");
  redirect(`/ventures/${slug}`);
}

export async function updateVentureAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireGlobal("settings:write");

    const workingDays = parseWorkingDays(formData);
    const parsed = updateVentureSchema.safeParse({
      id: formData.get("id"),
      name: formData.get("name") ?? undefined,
      timezone: formData.get("timezone") ?? undefined,
      tagColor: formData.get("tagColor") ?? undefined,
      workingDays: workingDays.length ? workingDays : undefined,
      dailyLogEditWindowHours: formData.get("dailyLogEditWindowHours")
        ? Number(formData.get("dailyLogEditWindowHours"))
        : undefined,
      defaultCurrency: formData.get("defaultCurrency") ?? undefined,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      return { error: "Check the highlighted fields.", fieldErrors };
    }

    const venture = await updateVenture(actor, parsed.data);
    revalidatePath("/ventures");
    revalidatePath(`/ventures/${venture.slug}`);
    revalidatePath("/");
    return {};
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Could not update the venture." };
  }
}

export async function archiveVentureAction(formData: FormData): Promise<void> {
  const actor = await requireGlobal("venture:archive");
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "") || undefined;
  await archiveVenture(actor, id, reason);
  revalidatePath("/ventures");
  revalidatePath("/");
  redirect("/ventures");
}
