import { autoStopStaleTimers, AUTO_STOP_HOURS } from "@/modules/time/time.service";
import { pruneLoginAttempts } from "@/lib/auth/rateLimit";
import {
  generateScheduledNotifications,
  pruneNotifications,
} from "@/modules/notifications/notification.service";

/**
 * Nightly housekeeping (Vercel Cron or any scheduler).
 *
 * Four jobs:
 *   - Force-stop timers left running past the threshold. The true elapsed time
 *     is recorded and flagged for review — never truncated or discarded,
 *     because these hours feed payroll.
 *   - Prune old login-attempt rows used for rate limiting.
 *   - Raise notifications for conditions nobody triggers by hand: work falling
 *     due, overdue tasks, expiring documents, accounts awaiting approval (§59).
 *   - Prune notifications that were read over a month ago.
 *
 * Protected by CRON_SECRET. Vercel Cron sends it as a Bearer token; any other
 * scheduler can send the same header. Without the secret set, the route
 * refuses to run rather than being open to the internet.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json(
      {
        error: {
          code: "NOT_CONFIGURED",
          message: "CRON_SECRET is not set, so scheduled jobs are disabled.",
        },
      },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid cron credentials." } },
      { status: 401 },
    );
  }

  try {
    const [stoppedTimers, prunedAttempts, notificationsRaised, prunedNotifications] =
      await Promise.all([
        autoStopStaleTimers(),
        pruneLoginAttempts(),
        generateScheduledNotifications(),
        pruneNotifications(),
      ]);

    return Response.json({
      ok: true,
      ranAt: new Date().toISOString(),
      staleTimersStopped: stoppedTimers,
      thresholdHours: AUTO_STOP_HOURS,
      loginAttemptsPruned: prunedAttempts,
      notificationsRaised,
      notificationsPruned: prunedNotifications,
    });
  } catch (e) {
    console.error("[cron] stale-timers failed:", e instanceof Error ? e.message : e);
    return Response.json(
      { error: { code: "INTERNAL", message: "The scheduled job failed." } },
      { status: 500 },
    );
  }
}
