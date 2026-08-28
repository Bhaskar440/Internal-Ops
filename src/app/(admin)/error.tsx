"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Error boundary for admin pages (§70).
 *
 * A permission failure must read as "you cannot see this", not as a crash.
 * Server errors carry a `digest` rather than the original message, so the code
 * is matched from the serialized error where Next preserves it, and anything
 * unrecognised falls back to a neutral message — internals are never shown.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin]", error.message, error.digest ?? "");
  }, [error]);

  const message = error.message ?? "";
  const forbidden = /permission|not authorized|FORBIDDEN/i.test(message);
  const notFound = /not found|NOT_FOUND/i.test(message);
  const authRequired = /sign in|UNAUTHENTICATED/i.test(message);

  const view = forbidden
    ? {
        icon: "🔒",
        title: "You do not have access to this",
        body: "Your role does not include this area. If you think that is wrong, ask an administrator.",
      }
    : notFound
      ? {
          icon: "🔍",
          title: "Not found",
          body: "This record does not exist, or it belongs to a venture you are not part of.",
        }
      : authRequired
        ? {
            icon: "🔑",
            title: "Please sign in again",
            body: "Your session has expired.",
          }
        : {
            icon: "⚠️",
            title: "Something went wrong",
            body: "The page could not be loaded. Try again, and tell an administrator if it keeps happening.",
          };

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-3 text-4xl">{view.icon}</div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{view.title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{view.body}</p>

      <div className="mt-6 flex justify-center gap-2">
        <Link href="/">
          <Button variant="secondary">Back to overview</Button>
        </Link>
        {!forbidden && !notFound && <Button onClick={reset}>Try again</Button>}
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-xs text-zinc-400 dark:text-zinc-600">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
