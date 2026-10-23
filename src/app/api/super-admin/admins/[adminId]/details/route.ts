import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import {
  Assignment,
  CompanySettings,
  DailyRate,
  Interview,
  LeadApproval,
  OfficialReport,
  Payment,
  PaymentAllocation,
  User,
  UserOrder,
  Workspace,
} from '@/lib/models';

const MAX_PAGE_SIZE = 100;

function safeAnnouncements(settings: unknown) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const items = (settings as { announcements?: unknown }).announcements;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const announcement = item as { id?: unknown; message?: unknown; createdAt?: unknown; updatedAt?: unknown };
    if (typeof announcement.id !== 'string' || typeof announcement.message !== 'string') return [];
    return [{
      id: announcement.id,
      message: announcement.message,
      createdAt: typeof announcement.createdAt === 'string' ? announcement.createdAt : '',
      updatedAt: typeof announcement.updatedAt === 'string' ? announcement.updatedAt : '',
    }];
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ adminId: string }> },
) {
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') {
    return NextResponse.json({ message: 'Only the Super Admin can view Admin details.' }, { status: 403 });
  }

  const { adminId } = await params;
  if (!adminId || adminId.length > 100) return NextResponse.json({ message: 'Invalid Admin.' }, { status: 400 });
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ message: 'Date must use YYYY-MM-DD.' }, { status: 400 });
  const page = Number(url.searchParams.get('page') || 1);
  const limit = Number(url.searchParams.get('limit') || 50);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });
  }

  await connectDB();
  const admin = await User.findOne({ _id: adminId, role: 'admin' })
    .select('name username email status workspaceId createdAt updatedAt')
    .lean();
  if (!admin) return NextResponse.json({ message: 'Admin not found.' }, { status: 404 });

  const workspace = await Workspace.findOne({ adminId: String(admin._id) })
    .select('_id name adminId description isActive createdAt updatedAt settings.announcements')
    .lean();
  if (workspace && String(workspace._id) !== String(admin.workspaceId || '')) {
    return NextResponse.json({ message: 'Admin and Workspace relationship is inconsistent.' }, { status: 409 });
  }
  if (!workspace && admin.workspaceId) {
    return NextResponse.json({ message: 'Admin Workspace relationship is inconsistent.' }, { status: 409 });
  }

  const empty = { items: [], total: 0, page, limit, hasMore: false };
  if (!workspace) {
    const company = await CompanySettings.findOne().select('announcement').lean();
    return NextResponse.json({
      admin: { id: String(admin._id), name: admin.name, username: admin.username, email: admin.email, status: admin.status, createdAt: admin.createdAt, updatedAt: admin.updatedAt },
      workspace: null,
      date,
      workers: empty,
      orders: empty,
      assignments: empty,
      reports: empty,
      rates: empty,
      clearances: empty,
      allocations: empty,
      payments: empty,
      interviews: empty,
      announcements: { global: company?.announcement || '', workspace: [] },
    });
  }

  const workspaceId = String(workspace._id);
  const offset = (page - 1) * limit;
  const scoped = { workspaceId };
  const [workers, workerTotal, orders, orderTotal, assignments, assignmentTotal, activeAssignedUsernames, rates, rateTotal, clearances, clearanceTotal, allocations, allocationTotal, payments, paymentTotal, interviews, interviewTotal, company] = await Promise.all([
    User.find({ role: 'worker', workspaceId }).select('name username email phone status createdAt').sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    User.countDocuments({ role: 'worker', workspaceId }),
    UserOrder.find(scoped).select('workerId requestedQuantity deliveredQuantity pendingQuantity status requestDate deliveryHistory createdAt updatedAt').sort({ requestDate: -1 }).skip(offset).limit(limit).lean(),
    UserOrder.countDocuments(scoped),
    Assignment.find(scoped).select('workerId assignedBy username status lastStopTime assignmentBatch assignmentDate createdAt updatedAt').sort({ assignmentDate: -1 }).skip(offset).limit(limit).lean(),
    Assignment.countDocuments(scoped),
    Assignment.distinct('username', { ...scoped, status: 'active' }),
    DailyRate.find(scoped).select('effectiveDate ratePerLead currency setBy createdAt updatedAt').sort({ effectiveDate: -1 }).skip(offset).limit(limit).lean(),
    DailyRate.countDocuments(scoped),
    LeadApproval.find(scoped).select('workerId reportDate normalizedUsername officialReportValue approvedLeads rejectedLeads adjustmentAmount reviewedBy reviewedAt').sort({ reportDate: -1 }).skip(offset).limit(limit).lean(),
    LeadApproval.countDocuments(scoped),
    PaymentAllocation.find(scoped).select('workerId reportDate paymentId status createdBy createdAt').sort({ reportDate: -1 }).skip(offset).limit(limit).lean(),
    PaymentAllocation.countDocuments(scoped),
    Payment.find(scoped).select('workerId paymentMethod currency grossAmount adjustmentTotal payableAmount allocations status clearedBy paidAt finalizedAt createdAt').sort({ finalizedAt: -1 }).skip(offset).limit(limit).lean(),
    Payment.countDocuments(scoped),
    Interview.find(scoped).select('workerId service answers status submittedAt reviewedBy reviewedAt resetAt history revision createdAt updatedAt').sort({ updatedAt: -1 }).skip(offset).limit(limit).lean(),
    Interview.countDocuments(scoped),
    CompanySettings.findOne().select('announcement').lean(),
  ]);
  const normalizedAssignedUsernames = activeAssignedUsernames.map((username) => String(username).toLowerCase());
  const visibleReportUsernames = normalizedAssignedUsernames.sort((a, b) => a.localeCompare(b)).slice(offset, offset + limit);
  const [reports, reportTotal] = await Promise.all([
    visibleReportUsernames.length
      ? OfficialReport.find({ ...scoped, reportDate: date, normalizedUsername: { $in: visibleReportUsernames } }).select('normalizedUsername reportValue reportDate').lean()
      : [],
    Promise.resolve(normalizedAssignedUsernames.length),
  ]);
  const reportValues = new Map(reports.map((item) => [item.normalizedUsername, item.reportValue]));
  const reportAssignments = visibleReportUsernames.length
    ? await Assignment.find({ ...scoped, status: 'active', username: { $in: visibleReportUsernames } }).select('username workerId').lean()
    : [];
  const reportWorkerByUsername = new Map(reportAssignments.map((item) => [String(item.username).toLowerCase(), item.workerId]));
  const reportItems = visibleReportUsernames.map((username) => ({
    username,
    workerId: reportWorkerByUsername.get(username) || null,
    reportValue: reportValues.has(username) ? reportValues.get(username)! : null,
    date,
  }));

  const workerIds = [...new Set([
    ...orders.map((item) => item.workerId),
    ...assignments.map((item) => item.workerId),
    ...clearances.map((item) => item.workerId),
    ...allocations.map((item) => item.workerId),
    ...payments.map((item) => item.workerId),
    ...interviews.map((item) => item.workerId),
    ...reportAssignments.map((item) => item.workerId),
  ])];
  const relatedWorkers = workerIds.length
    ? await User.find({ _id: { $in: workerIds }, role: 'worker', workspaceId }).select('name username').lean()
    : [];
  const workerName = (workerId: string) => relatedWorkers.find((worker) => String(worker._id) === workerId)?.name || null;
  const paged = <T,>(items: T[], total: number) => ({ items, total, page, limit, hasMore: page * limit < total });

  return NextResponse.json({
    admin: { id: String(admin._id), name: admin.name, username: admin.username, email: admin.email, status: admin.status, createdAt: admin.createdAt, updatedAt: admin.updatedAt },
    workspace: { id: workspaceId, name: workspace.name, description: workspace.description || '', isActive: workspace.isActive, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt },
    date,
    workers: paged(workers.map((worker) => ({ id: String(worker._id), name: worker.name, username: worker.username, email: worker.email, phone: worker.phone || '', status: worker.status, createdAt: worker.createdAt })), workerTotal),
    orders: paged(orders.map((item) => ({ id: String(item._id), workerId: item.workerId, workerName: workerName(item.workerId), requestedQuantity: item.requestedQuantity, deliveredQuantity: item.deliveredQuantity, pendingQuantity: item.pendingQuantity, status: item.status, requestDate: item.requestDate, deliveryHistory: item.deliveryHistory, createdAt: item.createdAt, updatedAt: item.updatedAt })), orderTotal),
    assignments: paged(assignments.map((item) => ({ id: String(item._id), workerId: item.workerId, workerName: workerName(item.workerId), username: item.username, status: item.status, lastStopTime: item.lastStopTime, assignmentBatch: item.assignmentBatch, assignmentDate: item.assignmentDate })), assignmentTotal),
    reports: paged(reportItems.map((item) => ({ username: item.username, workerName: item.workerId ? workerName(item.workerId) : null, reportValue: item.reportValue, date: item.date })), reportTotal),
    rates: paged(rates.map((item) => ({ id: String(item._id), effectiveDate: item.effectiveDate, ratePerLead: item.ratePerLead, currency: item.currency, setBy: item.setBy, updatedAt: item.updatedAt })), rateTotal),
    clearances: paged(clearances.map((item) => ({ id: String(item._id), workerId: item.workerId, workerName: workerName(item.workerId), reportDate: item.reportDate, username: item.normalizedUsername, officialReportValue: item.officialReportValue, approvedLeads: item.approvedLeads, rejectedLeads: item.rejectedLeads, adjustmentAmount: item.adjustmentAmount, reviewedAt: item.reviewedAt })), clearanceTotal),
    allocations: paged(allocations.map((item) => ({ id: String(item._id), workerId: item.workerId, workerName: workerName(item.workerId), reportDate: item.reportDate, paymentId: item.paymentId, status: item.status, createdAt: item.createdAt })), allocationTotal),
    payments: paged(payments.map((item) => ({ id: String(item._id), workerId: item.workerId, workerName: workerName(item.workerId), paymentMethod: item.paymentMethod, currency: item.currency, grossAmount: item.grossAmount, adjustmentTotal: item.adjustmentTotal, payableAmount: item.payableAmount, allocations: item.allocations, status: item.status, paidAt: item.paidAt, finalizedAt: item.finalizedAt })), paymentTotal),
    interviews: paged(interviews.map((item) => ({ id: String(item._id), workerId: item.workerId, workerName: workerName(item.workerId), service: item.service, answers: item.answers, status: item.status, submittedAt: item.submittedAt, reviewedBy: item.reviewedBy, reviewedAt: item.reviewedAt, resetAt: item.resetAt, history: item.history, revision: item.revision })), interviewTotal),
    announcements: { global: company?.announcement || '', workspace: safeAnnouncements(workspace.settings) },
  });
}
