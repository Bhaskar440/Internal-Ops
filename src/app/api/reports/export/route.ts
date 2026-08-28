import { requireActiveActor } from "@/lib/auth/actor";
import { isSuperAdmin } from "@/lib/permissions/types";
import {
  hoursReport,
  venturePerformance,
  personPerformance,
  taskEfficiencyReport,
  toCsv,
} from "@/modules/reports/report.service";
import { toErrorResponse, forbidden } from "@/lib/errors/appError";
import { minutesToHours } from "@/lib/money/efficiency";

/**
 * CSV export (§62).
 *
 * Built server-side from exactly the data this caller is allowed to see — the
 * same scoped service functions the screen uses, so an export can never widen
 * access. Hours are written in decimal hours for spreadsheet use, derived from
 * the stored minutes.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireActiveActor();

    const canReport =
      isSuperAdmin(actor) || [...actor.memberships.values()].includes("MANAGER");
    if (!canReport) throw forbidden("You are not authorized to export reports.");

    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "hours";
    const filters = {
      ventureId: url.searchParams.get("venture") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    };

    let csv: string;
    let filename: string;

    if (type === "ventures") {
      const rows = await venturePerformance(actor, filters);
      csv = toCsv(
        rows.map((r) => ({
          ...r,
          estimatedHours: minutesToHours(r.estimatedMinutes).toFixed(2),
          actualHours: minutesToHours(r.actualMinutes).toFixed(2),
          efficiency: r.efficiency === null ? "-" : r.efficiency.toFixed(1),
          overduePercent: r.overduePercent.toFixed(1),
        })),
        [
          { key: "ventureName", label: "Venture" },
          { key: "tasksCompleted", label: "Tasks completed" },
          { key: "tasksOpen", label: "Tasks open" },
          { key: "tasksOverdue", label: "Tasks overdue" },
          { key: "estimatedHours", label: "Estimated hours" },
          { key: "actualHours", label: "Actual hours" },
          { key: "efficiency", label: "Efficiency %" },
          { key: "overduePercent", label: "Overdue %" },
        ],
      );
      filename = "venture-performance";
    } else if (type === "people") {
      const rows = await personPerformance(actor, filters);
      csv = toCsv(
        rows.map((r) => ({
          ...r,
          estimatedHours: minutesToHours(r.estimatedMinutes).toFixed(2),
          actualHours: minutesToHours(r.actualMinutes).toFixed(2),
          efficiency: r.efficiency === null ? "-" : r.efficiency.toFixed(1),
          attendance: r.attendancePercent === null ? "-" : r.attendancePercent.toFixed(1),
        })),
        [
          { key: "personName", label: "Person" },
          { key: "employmentType", label: "Employment type" },
          { key: "tasksCompleted", label: "Tasks completed" },
          { key: "estimatedHours", label: "Estimated hours" },
          { key: "actualHours", label: "Actual hours" },
          { key: "efficiency", label: "Efficiency %" },
          { key: "daysPresent", label: "Present" },
          { key: "daysRemote", label: "Remote" },
          { key: "daysLeave", label: "Leave" },
          { key: "daysAbsent", label: "Absent" },
          { key: "attendance", label: "Attendance %" },
        ],
      );
      filename = "person-performance";
    } else if (type === "attendance") {
      const rows = await personPerformance(actor, filters);
      csv = toCsv(
        rows.map((r) => ({
          ...r,
          attendance: r.attendancePercent === null ? "-" : r.attendancePercent.toFixed(1),
        })),
        [
          { key: "personName", label: "Person" },
          { key: "employmentType", label: "Employment type" },
          { key: "daysPresent", label: "Present" },
          { key: "daysRemote", label: "Remote" },
          { key: "daysLeave", label: "Leave" },
          { key: "daysAbsent", label: "Absent" },
          { key: "attendance", label: "Attendance %" },
        ],
      );
      filename = "attendance";
    } else if (type === "tasks") {
      const rows = await taskEfficiencyReport(actor, filters);
      csv = toCsv(
        rows.map((r) => ({
          ...r,
          estimatedHours: minutesToHours(r.estimatedMinutes).toFixed(2),
          actualHours: minutesToHours(r.actualMinutes).toFixed(2),
          varianceHours: minutesToHours(r.varianceMinutes).toFixed(2),
          efficiency: r.efficiency === null ? "-" : r.efficiency.toFixed(1),
        })),
        [
          { key: "title", label: "Task" },
          { key: "ventureName", label: "Venture" },
          { key: "status", label: "Status" },
          { key: "estimatedHours", label: "Estimated hours" },
          { key: "actualHours", label: "Actual hours" },
          { key: "varianceHours", label: "Variance hours" },
          { key: "efficiency", label: "Efficiency %" },
        ],
      );
      filename = "task-efficiency";
    } else {
      const rows = await hoursReport(actor, filters);
      csv = toCsv(
        rows.map((r) => ({
          ...r,
          loggedHours: minutesToHours(r.minutes).toFixed(2),
          approvedHours: minutesToHours(r.approvedMinutes).toFixed(2),
        })),
        [
          { key: "personName", label: "Person" },
          { key: "ventureName", label: "Venture" },
          { key: "loggedHours", label: "Logged hours" },
          { key: "approvedHours", label: "Approved hours" },
        ],
      );
      filename = "hours";
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}-${stamp}.csv"`,
      },
    });
  } catch (e) {
    const { status, body } = toErrorResponse(e);
    return Response.json(body, { status });
  }
}
