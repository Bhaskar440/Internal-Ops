import { z } from "zod";

/** Validation for people and memberships (§53). */

export const employmentTypeSchema = z.enum(["EMPLOYEE", "FREELANCER", "CONTRACTOR"]);
export const accessRoleSchema = z.enum(["MANAGER", "MEMBER"]);
export const accountStatusSchema = z.enum(["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE"]);

export const createPersonSchema = z.object({
  name: z.string().trim().min(2, "Enter a full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  /** Employment type is orthogonal to access role (§5). */
  employmentType: employmentTypeSchema,
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker.")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  /** Optional initial venture assignments. */
  ventureIds: z.array(z.string().min(1)).default([]),
  accessRole: accessRoleSchema.default("MEMBER"),
});

export const updatePersonSchema = z.object({
  personId: z.string().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  employmentType: employmentTypeSchema.optional(),
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const setMembershipSchema = z.object({
  personId: z.string().min(1),
  ventureId: z.string().min(1),
  accessRole: accessRoleSchema,
});

export const removeMembershipSchema = z.object({
  personId: z.string().min(1),
  ventureId: z.string().min(1),
});

export const setAccountStatusSchema = z.object({
  userId: z.string().min(1),
  status: accountStatusSchema,
  reason: z.string().trim().max(500).optional(),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type SetMembershipInput = z.infer<typeof setMembershipSchema>;
export type SetAccountStatusInput = z.infer<typeof setAccountStatusSchema>;

export const EMPLOYMENT_TYPES = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "FREELANCER", label: "Freelancer" },
  { value: "CONTRACTOR", label: "Contractor" },
] as const;

export const ACCESS_ROLES = [
  { value: "MEMBER", label: "Member" },
  { value: "MANAGER", label: "Manager" },
] as const;
