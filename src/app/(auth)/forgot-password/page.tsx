import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
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
          <h2 className="mb-1 font-semibold text-zinc-900 dark:text-zinc-50">
            Reset your password
          </h2>
          <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
            Enter your email and we will send you a link to set a new password.
          </p>
          <ForgotPasswordForm />
        </div>

        <p className="mt-6 text-center text-sm">
          <Link
            href="/login"
            className="text-zinc-600 hover:underline dark:text-zinc-400"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
