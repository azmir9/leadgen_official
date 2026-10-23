import type { ClientSession } from 'mongoose';
import { DailyRate, LeadApproval, PaymentAllocation, User } from '@/lib/models';

export type ClearanceLine = {
  reportDate: string;
  approvedLeads: number;
  currency: string;
  ratePerLead: number;
  adjustmentAmount: number;
  adjustmentReason: string;
  amount: number;
};

export async function buildClearancePreview(workspaceId: string, workerId: string, reportDates: string[], session?: ClientSession) {
  const workerQuery = User.findOne({ _id: workerId, role: 'worker', workspaceId }).select('_id status paymentAccounts');
  if (session) workerQuery.session(session);
  const worker = await workerQuery.lean();
  if (!worker || worker.status !== 'active') return { error: 'Active worker not found in this workspace.' as const };

  const dates = [...new Set(reportDates)].sort();
  if (!dates.length || dates.some((date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date;
  })) {
    return { error: 'Select one or more valid report dates.' as const };
  }

  const approvalsQuery = LeadApproval.find({ workspaceId, workerId, reportDate: { $in: dates } });
  const allocationsQuery = PaymentAllocation.find({ workspaceId, workerId, reportDate: { $in: dates }, status: 'active' }).select('reportDate');
  if (session) {
    approvalsQuery.session(session);
    allocationsQuery.session(session);
  }
  const [approvals, allocations] = await Promise.all([approvalsQuery.lean(), allocationsQuery.lean()]);
  const allocatedDates = new Set(allocations.map((allocation) => allocation.reportDate));
  const approvalDates = new Set(approvals.map((approval) => approval.reportDate));
  const missing = dates.filter((date) => !approvalDates.has(date));
  const alreadyPaid = dates.filter((date) => allocatedDates.has(date));
  const lines: ClearanceLine[] = [];

  for (const date of dates) {
    if (allocatedDates.has(date)) continue;
    const dailyRateQuery = DailyRate.findOne({ workspaceId, effectiveDate: { $lte: date } }).sort({ effectiveDate: -1 });
    if (session) dailyRateQuery.session(session);
    const dailyRate = await dailyRateQuery.lean();
    if (!dailyRate) return { error: `No daily rate is configured for ${date}.` as const, missing, alreadyPaid };

    const dateApprovals = approvals.filter((approval) => approval.reportDate === date);
    if (!dateApprovals.length) continue;
    const approvedLeads = dateApprovals.reduce((sum, approval) => sum + approval.approvedLeads, 0);
    const adjustmentAmount = dateApprovals.reduce((sum, approval) => sum + approval.adjustmentAmount, 0);
    const amount = approvedLeads * dailyRate.ratePerLead + adjustmentAmount;
    if (amount < 0) return { error: `Adjustments make the payable amount negative for ${date}.` as const, missing, alreadyPaid };
    lines.push({
      reportDate: date,
      approvedLeads,
      currency: dailyRate.currency,
      ratePerLead: dailyRate.ratePerLead,
      adjustmentAmount,
      adjustmentReason: dateApprovals.map((approval) => approval.adjustmentReason).filter(Boolean).join('; '),
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
    });
  }

  if (new Set(lines.map((line) => line.currency)).size > 1) {
    return { error: 'Selected dates use different currencies. Clear them in separate payments.' as const, missing, alreadyPaid };
  }

  const grossAmount = lines.reduce((sum, line) => sum + line.approvedLeads * line.ratePerLead, 0);
  const adjustmentTotal = lines.reduce((sum, line) => sum + line.adjustmentAmount, 0);
  return {
    worker: { id: String(worker._id), status: worker.status, paymentAccounts: worker.paymentAccounts || {} },
    lines,
    missing,
    alreadyPaid,
    grossAmount: Math.round((grossAmount + Number.EPSILON) * 100) / 100,
    adjustmentTotal: Math.round((adjustmentTotal + Number.EPSILON) * 100) / 100,
    payableAmount: Math.round((lines.reduce((sum, line) => sum + line.amount, 0) + Number.EPSILON) * 100) / 100,
    currency: lines[0]?.currency || 'BDT',
  };
}
