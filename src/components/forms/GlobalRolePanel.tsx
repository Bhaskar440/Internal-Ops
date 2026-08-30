"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { setGlobalRoleAction } from "@/app/(admin)/people/actions";

/**
 * Grant or revoke Super Admin (§7).
 *
 * Both directions ask for confirmation, and the grant spells out what is being
 * handed over: Super Admins are equal, so a promotion cannot be relied on to be
 * reversible — the new admin can demote whoever promoted them.
 */
export function GlobalRolePanel({
  userId,
  personId,
  personName,
  isSuper,
  isSelf,
  canDemote,
}: {
  userId: string;
  personId: string;
  personName: string;
  isSuper: boolean;
  isSelf: boolean;
  /** False when this is the last active Super Admin; the server refuses too. */
  canDemote: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (isSuper && !canDemote) {
    return (
      <p className="mt-6 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        This is the last active Super Admin. Promote someone else before removing this role.
      </p>
    );
  }

  return (
    <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Super Admin access
      </h3>

      {!confirming ? (
        <>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            {isSuper
              ? `${personName} can currently see and change everything, including payroll.`
              : `${personName} is a regular user, limited to their own ventures.`}
          </p>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setConfirming(true)}
          >
            {isSuper ? "Remove Super Admin" : "Make Super Admin"}
          </Button>
        </>
      ) : (
        <form action={setGlobalRoleAction} className="space-y-3">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="personId" value={personId} />
          <input
            type="hidden"
            name="globalRole"
            value={isSuper ? "USER" : "SUPER_ADMIN"}
          />

          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {isSuper ? (
              isSelf ? (
                <>
                  You are removing your own Super Admin access. You will lose payroll,
                  people and settings straight away, and will need another Super Admin
                  to give it back.
                </>
              ) : (
                <>
                  {personName} will lose access to payroll, people and settings.
                </>
              )
            ) : (
              <>
                {personName} will be able to see and change <strong>everything</strong>,
                including payroll and every person&rsquo;s pay rate. They will also be
                able to remove your own Super Admin access — all Super Admins are equal,
                so treat this as permanent.
              </>
            )}
          </div>

          <label className="block text-xs text-zinc-600 dark:text-zinc-400">
            Reason (recorded in the audit log)
            <input
              name="reason"
              maxLength={500}
              placeholder="Why is this changing?"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>

          <div className="flex gap-2">
            <Button type="submit" variant={isSuper ? "secondary" : "primary"}>
              {isSuper ? "Yes, remove access" : "Yes, make Super Admin"}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
