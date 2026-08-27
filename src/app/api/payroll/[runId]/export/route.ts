import { requireGlobal } from "@/lib/permissions/guard";
import { getRun } from "@/modules/payroll/payroll.service";
import { toCsv } from "@/modules/reports/report.service";
import { toErrorResponse } from "@/lib/errors/appError";
import { minutesToHours } from "@/lib/money/efficiency";

/**
 * Payroll CSV export (§40).
 *
 * This is the handoff to whatever actually pays people — a bank file, Deel,
 * Zoho, or a finance team. Portfolio Ops stops here: it never moves money.
 *
 * Amounts come from the stored payroll lines, so an export of a locked run
 * reproduces exactly what was approved, regardless of later rate changes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const actor = await requireGlobal("payroll:read");
    const run = await getRun(actor, runId);

    const csv = toCsv(
      run.lines.map((l) => ({
        personName: l.personName,
        payType: l.payType,
        currency: l.currency,
        rate: l.rate,
        approvedHours: minutesToHours(l.approvedMinutes).toFixed(2),
        eligibleDays: l.eligibleDays ?? "",
        workingDays: l.workingDays ?? "",
        computedPay: l.computedPay,
        paymentStatus: l.paymentStatus,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
      })),
      [
        { key: "personName", label: "Person" },
        { key: "payType", label: "Pay type" },
        { key: "currency", label: "Currency" },
        { key: "rate", label: "Rate" },
        { key: "approvedHours", label: "Approved hours" },
        { key: "eligibleDays", label: "Eligible days" },
        { key: "workingDays", label: "Working days" },
        { key: "computedPay", label: "Gross pay" },
        { key: "paymentStatus", label: "Payment status" },
        { key: "periodStart", label: "Period start" },
        { key: "periodEnd", label: "Period end" },
      ],
    );

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payroll-${run.periodStart}-to-${run.periodEnd}.csv"`,
      },
    });
  } catch (e) {
    const { status, body } = toErrorResponse(e);
    return Response.json(body, { status });
  }
}
