import Link from "next/link";
import { isResetTokenValid } from "../../forgot-password/actions";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = await isResetTokenValid(token);

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
          {!valid ? (
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-xl dark:bg-red-950">
                &#9888;
              </div>
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                Link no longer valid
              </h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                This reset link has expired or has already been used.
              </p>
              <Link
                href="/forgot-password"
                className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h2 className="mb-1 font-semibold text-zinc-900 dark:text-zinc-50">
                Set a new password
              </h2>
              <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
                Signing in elsewhere will require the new password.
              </p>
              <ResetPasswordForm token={token} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
