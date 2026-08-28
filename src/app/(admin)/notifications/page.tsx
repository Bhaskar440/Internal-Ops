import Link from "next/link";
import { requireActiveActor } from "@/lib/auth/actor";
import { listMyNotifications } from "@/modules/notifications/notification.service";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { markReadAction, markAllReadAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

const KIND_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  TASK_ASSIGNED: "blue",
  TASK_DUE_SOON: "amber",
  TASK_OVERDUE: "red",
  DAILY_LOG_MISSING: "amber",
  DAILY_LOG_REJECTED: "red",
  DOCUMENT_EXPIRING: "amber",
  ACCOUNT_AWAITING_APPROVAL: "amber",
  PAYROLL_EXCEPTION: "red",
};

/** In-app alert centre (§59). Shows only the signed-in person's own alerts. */
export default async function NotificationsPage() {
  const actor = await requireActiveActor();
  const notifications = await listMyNotifications(actor);
  const unread = notifications.filter((n) => !n.read);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Work that needs your attention. Only you can see these."
        action={
          unread.length > 0 ? (
            <form action={markAllReadAction}>
              <Button variant="secondary" type="submit">
                Mark all read
              </Button>
            </form>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <EmptyState
          title="Nothing to catch up on"
          description="Task assignments, approaching deadlines and returned daily logs appear here."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card
              key={n.id}
              className={n.read ? "opacity-70" : "border-blue-200 dark:border-blue-900"}
            >
              <div className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.read && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-blue-600"
                        aria-label="Unread"
                      />
                    )}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {n.title}
                    </span>
                    <Badge tone={KIND_TONE[n.kind] ?? "neutral"}>
                      {n.kind.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </div>
                  {n.body && (
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{n.body}</p>
                  )}
                  <p className="mt-1 text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                    {n.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  {n.link && (
                    <Link href={n.link}>
                      <Button variant="secondary" className="px-3 py-1 text-xs">
                        Open
                      </Button>
                    </Link>
                  )}
                  {!n.read && (
                    <form action={markReadAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <Button variant="ghost" type="submit" className="px-3 py-1 text-xs">
                        Mark read
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
