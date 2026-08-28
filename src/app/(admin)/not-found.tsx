import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function AdminNotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-3 text-4xl">🔍</div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Not found</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This record does not exist, or it belongs to a venture you are not part of.
      </p>
      <div className="mt-6">
        <Link href="/">
          <Button variant="secondary">Back to overview</Button>
        </Link>
      </div>
    </div>
  );
}
