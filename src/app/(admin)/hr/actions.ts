"use server";

import { revalidatePath } from "next/cache";
import { requireGlobal } from "@/lib/permissions/guard";
import {
  createAsset,
  issueAsset,
  returnAsset,
  saveDocument,
} from "@/modules/hr/hr.service";
import { isAppError } from "@/lib/errors/appError";

export type HrFormState = { error?: string };

export async function createAssetAction(
  _prev: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  try {
    const actor = await requireGlobal("person:update:profile");
    const itemName = String(formData.get("itemName") ?? "").trim();
    if (itemName.length < 2) return { error: "Give the asset a name." };

    await createAsset(actor, {
      itemName,
      assetTag: String(formData.get("assetTag") ?? "").trim() || undefined,
      serialNumber: String(formData.get("serialNumber") ?? "").trim() || undefined,
      notes: String(formData.get("notes") ?? "").trim() || undefined,
    });

    revalidatePath("/hr");
    return {};
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Could not register the asset." };
  }
}

export async function issueAssetAction(formData: FormData): Promise<void> {
  const actor = await requireGlobal("person:update:profile");
  await issueAsset(actor, {
    assetId: String(formData.get("assetId")),
    personId: String(formData.get("personId")),
    condition: String(formData.get("condition") ?? "") || undefined,
  });
  revalidatePath("/hr");
}

export async function returnAssetAction(formData: FormData): Promise<void> {
  const actor = await requireGlobal("person:update:profile");
  await returnAsset(actor, {
    assetId: String(formData.get("assetId")),
    condition: String(formData.get("condition") ?? "") || undefined,
  });
  revalidatePath("/hr");
}

export async function saveDocumentAction(
  _prev: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  try {
    const actor = await requireGlobal("person:update:profile");
    const docType = String(formData.get("docType") ?? "").trim();
    if (docType.length < 2) return { error: "Give the document a type." };

    await saveDocument(actor, {
      documentId: String(formData.get("documentId") ?? "") || undefined,
      personId: String(formData.get("personId")),
      docType,
      status: String(formData.get("status") ?? "PENDING"),
      expiryDate: String(formData.get("expiryDate") ?? "") || undefined,
      externalLink: String(formData.get("externalLink") ?? "").trim() || undefined,
      notes: String(formData.get("notes") ?? "").trim() || undefined,
    });

    revalidatePath("/hr");
    return {};
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Could not save the document record." };
  }
}
