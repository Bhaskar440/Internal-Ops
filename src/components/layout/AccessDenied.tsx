import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Rendered when a signed-in person reaches an area their role does not cover
 * (§70). A refusal should read as a refusal, not as a crash.
 */
export function AccessDenied({
  area,
  reason,
}: {
  area: string;
  reason?: string;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-3 text-4xl">🔒</div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        You do not have access to {area}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {reason ??
          "Your role does not include this area. If you think that is wrong, ask an administrator."}
      </p>
      <div className="mt-6">
        <Link href="/">
          <Button variant="secondary">Back to overview</Button>
        </Link>
      </div>
    </div>
  );
}
