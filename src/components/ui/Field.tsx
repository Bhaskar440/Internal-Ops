import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const CONTROL =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm " +
  "placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 " +
  "disabled:bg-zinc-100 disabled:text-zinc-500 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:disabled:bg-zinc-800";

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
    >
      {children}
    </label>
  );
}

/**
 * Widest range any date field in the product should accept.
 *
 * Without a bound, a native date input takes a six-digit year — typing into the
 * year segment simply keeps going — and "year 202600" reaches the server as a
 * valid date. Setting min/max makes the browser's own picker enforce the range
 * before that happens; the Zod schemas still validate server-side.
 */
export const DATE_MIN = "2000-01-01";
export const DATE_MAX = "2100-12-31";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const bounded =
    props.type === "date" ? { min: DATE_MIN, max: DATE_MAX, ...props } : props;
  return <input className={cn(CONTROL, className)} {...bounded} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, className)} {...props} />;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{children}</p>;
}

export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{children}</p>;
}
