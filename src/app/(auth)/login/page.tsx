import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Portfolio Ops" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in? Nothing to do here.
  const actor = await resolveActor();
  if (actor) redirect("/");

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-blue-600 dark:text-blue-400">
            Internal system of record
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Portfolio Ops
          </h1>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <LoginForm />
        </div>

        <p className="mt-4 text-center text-sm">
          <a
            href="/forgot-password"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Forgot your password?
          </a>
        </p>

        <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
