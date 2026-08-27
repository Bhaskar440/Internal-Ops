import { signOut } from "@/lib/auth/config";
import { Button } from "@/components/ui/Button";

/** Shown to a signed-in account still awaiting administrator approval (§7). */
export function PendingApproval({ name }: { name: string }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-xl dark:bg-amber-950">
          ⏳
        </div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Awaiting approval
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Thanks, {name}. An administrator needs to approve your account and assign
          your ventures before you can start work.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="mt-6"
        >
          <Button variant="secondary" type="submit" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
