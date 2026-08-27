import { z } from "zod";
import { isValidTimezone } from "@/lib/timezone/businessDate";

/**
 * Shared validation for ventures (§53). The same schemas run client-side for
 * fast feedback and server-side for authority.
 */

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ventureSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must be at least 2 characters.")
  .max(50, "Slug must be 50 characters or fewer.")
  .regex(slugPattern, "Use lowercase letters, numbers and hyphens only.");

export const timezoneSchema = z
  .string()
  .trim()
  .refine(isValidTimezone, "Choose a valid timezone.");

/** ISO weekday numbers, 1=Mon .. 7=Sun. */
export const workingDaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1, "Select at least one working day.")
  .max(7)
  .refine((d) => new Set(d).size === d.length, "Working days must be unique.")
  .transform((d) => [...d].sort((a, b) => a - b));

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, "Use a 3-letter ISO currency code, e.g. INR.")
  .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code, e.g. INR.");

export const createVentureSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
  slug: ventureSlugSchema,
  timezone: timezoneSchema,
  tagColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.")
    .default("#2563eb"),
  workingDays: workingDaysSchema,
  dailyLogEditWindowHours: z
    .number()
    .int("Enter whole hours.")
    .min(0, "Cannot be negative.")
    .max(720, "That is more than 30 days."),
  defaultCurrency: currencySchema,
});

export const updateVentureSchema = createVentureSchema.partial().extend({
  id: z.string().min(1),
});

export type CreateVentureInput = z.infer<typeof createVentureSchema>;
export type UpdateVentureInput = z.infer<typeof updateVentureSchema>;

/** Common IANA zones offered in the UI. Any valid zone is accepted. */
export const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
] as const;

export const COMMON_CURRENCIES = ["INR", "AED", "USD", "EUR", "GBP", "SGD"] as const;

export const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;
