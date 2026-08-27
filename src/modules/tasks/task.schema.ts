import { z } from "zod";

/** Validation for tasks (§15, §17, §53). */

export const taskStatusSchema = z.enum(["BACKLOG", "IN_PROGRESS", "REVIEW", "DONE"]);
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const TASK_STATUSES = [
  { value: "BACKLOG", label: "Backlog" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "REVIEW", label: "Review" },
  { value: "DONE", label: "Done" },
] as const;

export const TASK_PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
] as const;

/**
 * Estimated hours are REQUIRED and cannot be empty (§17). The form collects
 * hours because that is how people think; the service converts to whole
 * minutes for storage (§15).
 */
export const estimatedHoursSchema = z
  .number({ message: "Estimated hours are required." })
  .positive("Estimated hours must be greater than zero.")
  .max(2000, "That is more than a year of work — split the task.");

export const createTaskSchema = z.object({
  ventureId: z.string().min(1, "Choose a venture."),
  title: z.string().trim().min(2, "Give the task a title.").max(200),
  description: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  estimatedHours: estimatedHoursSchema,
  priority: taskPrioritySchema.default("MEDIUM"),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker.")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  assigneeIds: z.array(z.string().min(1)).default([]),
  /** §39: optional fixed fee for per-task freelancers. */
  fixedFee: z.number().positive().max(10_000_000).optional(),
  feeCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});

export const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  estimatedHours: estimatedHoursSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  assigneeIds: z.array(z.string().min(1)).optional(),
  fixedFee: z.number().positive().max(10_000_000).nullable().optional(),
  feeCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
});

export const changeStatusSchema = z.object({
  taskId: z.string().min(1),
  status: taskStatusSchema,
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

/** Forward order of the default Kanban flow (§18). */
const ORDER: Record<string, number> = {
  BACKLOG: 0,
  IN_PROGRESS: 1,
  REVIEW: 2,
  DONE: 3,
};

/** True when the move goes backwards, which only admin/manager may do (§18). */
export function isBackwardTransition(from: string, to: string): boolean {
  return ORDER[to] < ORDER[from];
}
