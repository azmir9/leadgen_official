import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, Interview, User } from '@/lib/models';
import { hashWorkerOnboardingToken, WORKER_ONBOARDING_COOKIE } from '@/lib/worker-onboarding';

const categories = [
  { key: 'lead-generation', name: 'Lead Generation' },
  { key: 'facebook-marketing', name: 'Facebook Marketing' },
  { key: 'google-ads', name: 'Google Ads' },
  { key: 'google-seo', name: 'Google SEO' },
  { key: 'youtube-marketing', name: 'YouTube Marketing' },
  { key: 'social-media-marketing', name: 'Social Media Marketing' },
  { key: 'telegram-marketing', name: 'Telegram Marketing' },
  { key: 'other-freelancing', name: 'Other Freelancing Work' },
] as const;
const platforms = ['Free Sites', 'Paid Sites', 'Posting Sites'] as const;
const legacyServices = ['lead-generation', 'facebook-marketing', 'youtube-marketing', 'google-ads', 'seo'] as const;
type Actor = { id: string; name: string; email: string; username: string; role: string; workspaceId: string | null; status: string; onboarding: boolean };

async function interviewActor(request: NextRequest, preferOnboarding = false): Promise<Actor | null> {
  const session = preferOnboarding ? null : await getSessionFromRequest(request);
  if (session) return { ...session, email: session.email, onboarding: false };
  const token = request.cookies.get(WORKER_ONBOARDING_COOKIE)?.value;
  if (!token) return null;
  await connectDB();
  const worker = await User.findOne({
    role: 'worker', status: 'pending', onboardingTokenHash: hashWorkerOnboardingToken(token),
    onboardingTokenExpiresAt: { $gt: new Date() },
  }).select('+onboardingTokenHash +onboardingTokenExpiresAt name email username role workspaceId status').lean();
  if (!worker) return null;
  return { id: String(worker._id), name: worker.name, email: worker.email, username: worker.username, role: worker.role, workspaceId: worker.workspaceId || null, status: worker.status, onboarding: true };
}

function cleanText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validOptionalUrl(value: string) {
  if (!value) return true;
  if (/^[A-Za-z0-9._-]{3,100}$/.test(value)) return true;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) && /(^|\.)((facebook\.com)|(fb\.com))$/i.test(url.hostname);
  } catch { return false; }
}

function validPhone(value: string) {
  return !value || /^[+()\d\s.-]{5,40}$/.test(value);
}

function workspaceFor(session: Actor, requested: string | null) {
  return session.role === 'admin' ? session.workspaceId : requested;
}

function urlSearchOnboarding(request: NextRequest) {
  return new URL(request.url).searchParams.get('onboarding') === '1';
}

export async function GET(request: NextRequest) {
  const session = await interviewActor(request, urlSearchOnboarding(request));
  if (!session) return NextResponse.json({ message: 'Sign in or continue your registration to view interviews.' }, { status: 401 });
  if (session.role === 'worker' && !session.workspaceId) return NextResponse.json({ interviews: [], worker: { name: session.name, email: session.email } });
  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get('workspaceId');
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const workspaceId = session.role === 'worker' ? session.workspaceId : workspaceFor(session, requestedWorkspaceId);
  if (!workspaceId) return NextResponse.json({ message: 'Select a workspace.' }, { status: 400 });
  await connectDB();

  const filter: Record<string, unknown> = { workspaceId };
  if (session.role === 'worker') filter.workerId = session.id;
  else if (url.searchParams.has('workerId')) filter.workerId = url.searchParams.get('workerId');
  const status = url.searchParams.get('status');
  if (status) {
    if (!['pending_review', 'submitted', 'reviewed', 'approved', 'reset'].includes(status)) return NextResponse.json({ message: 'Invalid interview status.' }, { status: 400 });
    filter.status = status === 'pending_review' ? { $in: ['pending_review', 'submitted'] } : status;
  }
  const escaped = (url.searchParams.get('q') || '').trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (escaped && session.role !== 'worker') {
    const matchingWorkers = await User.find({ workspaceId, role: 'worker', $or: [{ name: { $regex: escaped, $options: 'i' } }, { username: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }] }).select('_id').lean();
    const matchingIds = matchingWorkers.map((worker) => String(worker._id));
    if (filter.workerId) {
      const requestedWorkerId = String(filter.workerId);
      if (!matchingIds.includes(requestedWorkerId)) filter.workerId = { $in: [] };
    } else filter.workerId = { $in: matchingIds };
  }
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page') || 1)));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  if (!Number.isInteger(page) || !Number.isInteger(limit)) return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });
  const [interviews, total] = await Promise.all([
    Interview.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Interview.countDocuments(filter),
  ]);
  const workerIds = session.role === 'worker' ? [session.id] : [...new Set(interviews.map((interview) => interview.workerId))];
  const workerFilter: Record<string, unknown> = { _id: { $in: workerIds }, role: 'worker', workspaceId };
  const workers = workerIds.length ? await User.find(workerFilter).select('name username email status').lean() : [];
  const visibleIds = new Set(workers.map((worker) => String(worker._id)));
  const visibleInterviews = interviews.filter((interview) => visibleIds.has(interview.workerId));
  return NextResponse.json({
    interviews: visibleInterviews.map((interview) => {
      const worker = workers.find((item) => String(item._id) === interview.workerId);
      return {
        id: String(interview._id), workerId: interview.workerId, workerName: worker?.name || null,
        workerUsername: worker?.username || null, workerEmail: worker?.email || null, workerStatus: worker?.status || null,
        service: interview.service, category: interview.category || interview.service, experienceAmount: interview.experienceAmount,
        experienceUnit: interview.experienceUnit, dailyLeadCapacity: interview.dailyLeadCapacity,
        workArrangement: interview.workArrangement, platforms: interview.platforms || [], description: interview.description || '',
        contact: interview.contact || {}, answers: interview.answers, status: interview.status, submittedAt: interview.submittedAt,
        reviewedBy: interview.reviewedBy, reviewedAt: interview.reviewedAt, revision: interview.revision,
        history: session.role === 'worker' ? undefined : interview.history,
      };
    }),
    worker: session.role === 'worker' ? { name: session.name, email: session.email } : undefined,
    page, limit, total, hasMore: page * limit < total,
  });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ message: 'Request body must be a JSON object.' }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const session = await interviewActor(request, urlSearchOnboarding(request));
  if (!session || session.role !== 'worker') return NextResponse.json({ message: 'Only Workers can submit interviews.' }, { status: 403 });
  if (!session.workspaceId) return NextResponse.json({ message: 'Your account is not assigned to a workspace.' }, { status: 409 });

  const category = cleanText(body.category, 50);
  const legacyService = cleanText(body.service, 50);
  const fullInterview = Boolean(category);
  if (session.onboarding && !fullInterview) return NextResponse.json({ message: 'Complete the full Worker interview form before submitting.' }, { status: 400 });
  if (fullInterview && !categories.some((item) => item.key === category)) return NextResponse.json({ message: 'Select a valid work category.' }, { status: 400 });
  if (!fullInterview && !legacyServices.includes(legacyService as (typeof legacyServices)[number])) return NextResponse.json({ message: 'Choose a supported interview service.' }, { status: 400 });

  let values: Record<string, unknown> = {};
  let answers: Record<string, string>;
  if (fullInterview) {
    const amountInput = body.experienceAmount;
    const capacityInput = body.dailyLeadCapacity;
    if ((typeof amountInput !== 'string' && typeof amountInput !== 'number') || String(amountInput).trim() === '' || (typeof capacityInput !== 'string' && typeof capacityInput !== 'number') || String(capacityInput).trim() === '') return NextResponse.json({ message: 'Experience and daily lead capacity are required.' }, { status: 400 });
    const experienceAmount = Number(body.experienceAmount);
    const experienceUnit = cleanText(body.experienceUnit, 10);
    const dailyLeadCapacity = Number(body.dailyLeadCapacity);
    const workArrangement = cleanText(body.workArrangement, 20);
    if (body.platforms !== undefined && !Array.isArray(body.platforms)) return NextResponse.json({ message: 'Work platforms must be a list.' }, { status: 400 });
    const selectedPlatforms = Array.isArray(body.platforms) ? body.platforms : [];
    const description = cleanText(body.description, 5000);
    const contactBody = body.contact && typeof body.contact === 'object' && !Array.isArray(body.contact) ? body.contact as Record<string, unknown> : {};
    if (body.contact !== undefined && (!body.contact || typeof body.contact !== 'object' || Array.isArray(body.contact) || Object.values(body.contact as Record<string, unknown>).some((value) => typeof value !== 'string'))) return NextResponse.json({ message: 'Contact details must be text fields.' }, { status: 400 });
    const contact = {
      contactNumber: cleanText(contactBody.contactNumber, 40), facebook: cleanText(contactBody.facebook, 300),
      whatsapp: cleanText(contactBody.whatsapp, 40), telegram: cleanText(contactBody.telegram, 100),
      additional: cleanText(contactBody.additional, 500),
    };
    if (!Number.isFinite(experienceAmount) || experienceAmount < 0 || experienceAmount > 1000 || !['months', 'years'].includes(experienceUnit)) return NextResponse.json({ message: 'Enter a valid experience amount and choose Months or Years.' }, { status: 400 });
    if (!Number.isSafeInteger(dailyLeadCapacity) || dailyLeadCapacity < 0 || dailyLeadCapacity > 1_000_000) return NextResponse.json({ message: 'Daily lead capacity must be a non-negative whole number.' }, { status: 400 });
    if (!['individual', 'team'].includes(workArrangement)) return NextResponse.json({ message: 'Choose individual or team work.' }, { status: 400 });
    if (selectedPlatforms.length > platforms.length || selectedPlatforms.some((item) => !platforms.includes(item))) return NextResponse.json({ message: 'Choose only the listed work platforms.' }, { status: 400 });
    if (!validPhone(contact.contactNumber) || !validPhone(contact.whatsapp) || !validOptionalUrl(contact.facebook) || (contact.telegram && !(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\/[A-Za-z0-9_+/-]+$/i.test(contact.telegram) || /^@?[A-Za-z0-9_]{5,32}$/.test(contact.telegram) || validPhone(contact.telegram)))) return NextResponse.json({ message: 'Check the contact number, Facebook link, WhatsApp number, or Telegram contact.' }, { status: 400 });
    values = { category, experienceAmount, experienceUnit, dailyLeadCapacity, workArrangement, platforms: [...new Set(selectedPlatforms as string[])], description, contact };
    answers = {
      'Work category': categories.find((item) => item.key === category)!.name,
      'Work experience': `${experienceAmount} ${experienceUnit}`,
      'Daily lead capacity': String(dailyLeadCapacity),
      'Work arrangement': workArrangement === 'individual' ? 'I work individually.' : 'I work with a team.',
      'Work platforms': (values.platforms as string[]).join(', ') || 'Not specified',
      'Knowledge and experience': description || 'Not provided',
    };
  } else {
    if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return NextResponse.json({ message: 'Answers must be provided as a question-to-answer object.' }, { status: 400 });
    answers = Object.fromEntries(Object.entries(body.answers as Record<string, unknown>).map(([question, answer]) => [question.trim().slice(0, 100), cleanText(answer, 3000)]));
    if (!Object.keys(answers).length || Object.keys(answers).length > 20 || Object.entries(answers).some(([question, answer]) => !question || !answer)) return NextResponse.json({ message: 'Answer every question with no more than 3,000 characters.' }, { status: 400 });
  }

  await connectDB();
  const service = fullInterview ? category : legacyService;
  const submittedAt = new Date();
  const databaseSession = await User.startSession();
  type SavedInterview = { _id: unknown; status: string; revision: number; submittedAt: Date };
  const state: { outcome: 'created' | 'updated' | 'duplicate' | 'category-conflict'; interview: SavedInterview | null } = { outcome: 'duplicate', interview: null };
  try {
    await databaseSession.withTransaction(async () => {
      const activeInterview = await Interview.findOne({ workspaceId: session.workspaceId, workerId: session.id, status: { $ne: 'reset' } }).session(databaseSession).lean();
      if (activeInterview) {
        state.outcome = activeInterview.service === service ? 'duplicate' : 'category-conflict';
        return;
      }
      const existing = await Interview.findOne({ workspaceId: session.workspaceId, workerId: session.id, service, status: 'reset' }).session(databaseSession).lean();
      const latestReset = await Interview.findOne({ workspaceId: session.workspaceId, workerId: session.id, status: 'reset' }).sort({ updatedAt: -1 }).session(databaseSession).lean();
      const serviceClaims: Record<string, unknown>[] = [
        { primaryInterviewService: null }, { primaryInterviewService: { $exists: false } }, { primaryInterviewService: service },
      ];
      if (latestReset?.service) serviceClaims.push({ primaryInterviewService: latestReset.service });
      const claim = await User.updateOne(
        { _id: session.id, role: 'worker', workspaceId: session.workspaceId, status: { $in: ['pending', 'active'] }, $or: serviceClaims },
        { $set: { primaryInterviewService: service } },
        { session: databaseSession },
      );
      if (claim.matchedCount !== 1) { state.outcome = 'category-conflict'; return; }
      const interviewData = { workspaceId: session.workspaceId, workerId: session.id, service, ...values, answers, status: fullInterview ? 'pending_review' : 'submitted', submittedAt };
      if (existing) {
        const updatedInterview = await Interview.findOneAndUpdate(
          { _id: existing._id, status: 'reset', workspaceId: session.workspaceId, workerId: session.id },
          { $set: { ...interviewData, reviewedBy: null, reviewedAt: null, resetBy: null, resetAt: null }, $inc: { revision: 1 } },
          { returnDocument: 'after', session: databaseSession },
        ).lean();
        if (!updatedInterview) { state.outcome = 'duplicate'; throw new Error('Interview reset state changed during resubmission.'); }
        state.interview = updatedInterview as SavedInterview;
        state.outcome = 'updated';
      } else {
        const [createdInterview] = await Interview.create([{ ...interviewData, revision: 1 }], { session: databaseSession });
        state.interview = createdInterview as SavedInterview;
        state.outcome = 'created';
      }
      if (!state.interview) throw new Error('Interview write returned no record.');
      await AuditLog.create([{ workspaceId: session.workspaceId, actorId: session.id, actorRole: session.role, action: state.outcome === 'updated' ? 'interview.resubmitted' : 'interview.submitted', resourceType: 'interview', resourceId: String(state.interview._id), details: { service, revision: state.interview.revision } }], { session: databaseSession });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Interview reset state changed during resubmission.') state.outcome = 'duplicate';
    else if (error && typeof error === 'object' && 'code' in error && error.code === 11000) state.outcome = 'duplicate';
    else throw error;
  } finally { await databaseSession.endSession(); }
  const outcome = String(state.outcome);
  const interview = state.interview;
  if (outcome === 'category-conflict') return NextResponse.json({ message: 'Only one primary work category can be active. Contact your Admin if you need to change it.' }, { status: 409 });
  if (outcome === 'duplicate' || !interview) return NextResponse.json({ message: 'This interview has already been submitted or changed. Refresh or contact your workspace Admin.' }, { status: 409 });
  const response = NextResponse.json({ success: true, interview: { id: String(interview._id), service, status: interview.status, revision: interview.revision, submittedAt: interview.submittedAt } }, { status: outcome === 'updated' ? 200 : 201 });
  if (session.onboarding) {
    await User.updateOne({ _id: session.id, role: 'worker', status: 'pending' }, { $unset: { onboardingTokenHash: 1, onboardingTokenExpiresAt: 1 } });
    response.cookies.set(WORKER_ONBOARDING_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 0, path: '/' });
  }
  return response;
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Only an Admin can review interviews.' }, { status: 403 });
  let body: { interviewId?: unknown; action?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const interviewId = String(body.interviewId || '');
  const action = String(body.action || '');
  const requestedWorkspaceId = body.workspaceId ? String(body.workspaceId) : null;
  if (!interviewId || !['review', 'reset', 'approve'].includes(action)) return NextResponse.json({ message: 'Provide an interview and a supported review action.' }, { status: 400 });
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const workspaceId = workspaceFor({ ...session, onboarding: false }, requestedWorkspaceId);
  if (!workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 400 });
  await connectDB();

  const existing = await Interview.findOne({ _id: interviewId, workspaceId }).lean();
  if (!existing) return NextResponse.json({ message: 'Interview not found in this workspace.' }, { status: 404 });
  if (action === 'approve') {
    if (!['pending_review', 'submitted', 'reviewed'].includes(existing.status)) return NextResponse.json({ message: 'Only a submitted interview can be approved.' }, { status: 409 });
    if (!existing.category || existing.experienceAmount == null || !existing.experienceUnit || existing.dailyLeadCapacity == null || !existing.workArrangement) return NextResponse.json({ message: 'This Worker needs to complete the current interview form before approval.' }, { status: 409 });
    const databaseSession = await User.startSession();
    let outcome: 'approved' | 'worker-not-pending' | 'interview-changed' = 'interview-changed';
    try {
      await databaseSession.withTransaction(async () => {
        const changedInterview = await Interview.findOne({ _id: interviewId, workspaceId, workerId: existing.workerId, status: existing.status }).session(databaseSession).lean();
        if (!changedInterview) { outcome = 'interview-changed'; return; }
        const workerUpdate = await User.updateOne(
          { _id: existing.workerId, role: 'worker', workspaceId, status: { $in: ['pending', 'inactive', 'blocked'] }, $or: [{ approvalRequired: true }, { status: 'pending', approvalRequired: { $exists: false } }] },
          { $set: { status: 'active', approvalRequired: false, approvedBy: session.id, approvedAt: new Date() }, $unset: { onboardingTokenHash: 1, onboardingTokenExpiresAt: 1 }, $inc: { sessionVersion: 1 } },
          { session: databaseSession },
        );
        if (workerUpdate.matchedCount !== 1) { outcome = 'worker-not-pending'; return; }
        const interviewUpdate = await Interview.updateOne(
          { _id: interviewId, workspaceId, workerId: existing.workerId, status: existing.status },
          { $set: { status: 'approved', reviewedBy: session.id, reviewedAt: new Date() } },
          { session: databaseSession },
        );
        if (interviewUpdate.matchedCount !== 1) { outcome = 'interview-changed'; throw new Error('Interview changed during approval.'); }
        await AuditLog.create([{ workspaceId, actorId: session.id, actorRole: session.role, action: 'worker.approved_after_interview', resourceType: 'user', resourceId: existing.workerId, details: { interviewId } }], { session: databaseSession });
        outcome = 'approved';
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Interview changed during approval.') outcome = 'interview-changed';
      else throw error;
    } finally { await databaseSession.endSession(); }
    const finalOutcome: string = String(outcome);
    if (finalOutcome !== 'approved') return NextResponse.json({ message: finalOutcome === 'worker-not-pending' ? 'Worker is no longer pending or is not in this workspace.' : 'Interview changed while approval was processing. Refresh and review the Worker status.' }, { status: 409 });
    return NextResponse.json({ success: true, status: 'approved', workerStatus: 'active' });
  }
  if (action === 'review' && !['submitted', 'pending_review'].includes(existing.status)) return NextResponse.json({ message: 'Only pending interviews can be marked reviewed.' }, { status: 409 });
  if (action === 'reset' && existing.status === 'reset') return NextResponse.json({ message: 'Interview is already reset.' }, { status: 409 });
  const update = action === 'review'
    ? { $set: { status: 'reviewed', reviewedBy: session.id, reviewedAt: new Date() } }
    : { $set: { status: 'reset', resetBy: session.id, resetAt: new Date(), reviewedBy: null, reviewedAt: null }, $push: { history: {
      answers: existing.answers, category: existing.category, experienceAmount: existing.experienceAmount, experienceUnit: existing.experienceUnit,
      dailyLeadCapacity: existing.dailyLeadCapacity, workArrangement: existing.workArrangement, platforms: existing.platforms,
      description: existing.description, contact: existing.contact, submittedAt: existing.submittedAt,
      reviewedAt: existing.reviewedAt, reviewedBy: existing.reviewedBy, revision: existing.revision,
    } } };
  const interview = await Interview.findOneAndUpdate({ _id: interviewId, workspaceId, status: existing.status }, update, { returnDocument: 'after' }).lean();
  if (!interview) return NextResponse.json({ message: 'Interview was changed by another request. Refresh and retry.' }, { status: 409 });
  await AuditLog.create({ workspaceId, actorId: session.id, actorRole: session.role, action: action === 'review' ? 'interview.reviewed' : 'interview.reset', resourceType: 'interview', resourceId: interviewId, details: { service: existing.service, previousStatus: existing.status, status: interview.status, revision: existing.revision } });
  return NextResponse.json({ success: true, status: interview.status });
}
