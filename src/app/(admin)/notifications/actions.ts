"use server";

import { revalidatePath } from "next/cache";
import { requireActiveActor } from "@/lib/auth/actor";
import { markRead, markAllRead } from "@/modules/notifications/notification.service";

export async function markReadAction(formData: FormData): Promise<void> {
  const actor = await requireActiveActor();
  await markRead(actor, String(formData.get("notificationId")));
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markAllReadAction(): Promise<void> {
  const actor = await requireActiveActor();
  await markAllRead(actor);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
