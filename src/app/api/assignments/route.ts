import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { Assignment, AuditLog, User } from '@/lib/models';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
  const requestedWorkspaceId = new URL(request.url).searchParams.get('workspaceId');
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  if (session.role === 'worker' && !session.workspaceId) return NextResponse.json({ assignments: [] });
  const workspaceId = session.role === 'worker' || session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId) return NextResponse.json({ message: 'Select a workspace.' }, { status: 400 });

  await connectDB();
  const filter = session.role === 'worker' ? { workspaceId, workerId: session.id } : { workspaceId };
  const assignments = await Assignment.find(filter).sort({ assignmentDate: -1 }).limit(500).lean();
  const workers = session.role === 'worker' ? [] : await User.find({ _id: { $in: assignments.map((item) => item.workerId) }, role: 'worker', workspaceId }).select('name username').lean();
  return NextResponse.json({ assignments: assignments.map((item) => ({
    id: String(item._id), workerId: item.workerId, workerName: workers.find((worker) => String(worker._id) === item.workerId)?.name || null,
    username: item.username, status: item.status, lastStopTime: item.lastStopTime, assignmentBatch: item.assignmentBatch, assignmentDate: item.assignmentDate,
  })) });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  let body: { workerId?: unknown; usernames?: unknown; lastStopTime?: unknown; workspaceId?: unknown; override?: unknown; expectedAssignments?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Invalid JSON.' }, { status: 400 }); }
  const workerId = String(body.workerId || '');
  const usernamesRaw = String(body.usernames || '');
  const requestedWorkspaceId = String(body.workspaceId || '');
  const override = body.override === true;
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  if (!workspaceId || !workerId) return NextResponse.json({ message: 'Workspace and worker are required.' }, { status: 400 });

  const usernames = [...new Set(usernamesRaw.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))];
  if (!usernames.length || usernames.length > 500 || usernames.some((name) => name.length > 100)) return NextResponse.json({ message: 'Enter between 1 and 500 valid usernames, one per line.' }, { status: 400 });
  const normalizedUsernames = usernames.map((username) => username.toLowerCase());
  const expectedAssignments = new Map<string, string>();
  if (override) {
    if (!Array.isArray(body.expectedAssignments)) return NextResponse.json({ message: 'Refresh assignments and confirm the reassignment again.' }, { status: 400 });
    for (const item of body.expectedAssignments) {
      if (!item || typeof item !== 'object' || !('username' in item) || !('workerId' in item)) return NextResponse.json({ message: 'Invalid reassignment confirmation.' }, { status: 400 });
      const expectedUsername = String(item.username).trim().toLowerCase();
      const expectedWorkerId = String(item.workerId).trim();
      if (!expectedUsername || !expectedWorkerId || expectedAssignments.has(expectedUsername)) return NextResponse.json({ message: 'Invalid reassignment confirmation.' }, { status: 400 });
      expectedAssignments.set(expectedUsername, expectedWorkerId);
    }
    if (expectedAssignments.size !== normalizedUsernames.length || normalizedUsernames.some((username) => !expectedAssignments.has(username))) {
      return NextResponse.json({ message: 'Refresh assignments and confirm the reassignment again.' }, { status: 400 });
    }
  }
  const stopTimeInput = body.lastStopTime ? String(body.lastStopTime) : '';
  if (stopTimeInput && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stopTimeInput)) return NextResponse.json({ message: 'Last stop time must be a local date and time.' }, { status: 400 });
  const stopTimeValue = stopTimeInput ? new Date(`${stopTimeInput}+06:00`) : null;
  if (stopTimeValue && Number.isNaN(stopTimeValue.getTime())) return NextResponse.json({ message: 'Invalid last stop time.' }, { status: 400 });

  await connectDB();

  if (!override) {
    type NormalAssignmentOutcome =
      | { type: 'worker-not-found' }
      | { type: 'no-accepted'; duplicates: string[]; reassignmentsRequired: { username: string; workerId: string }[] }
      | { type: 'created'; batchId: string; inserted: number; duplicates: string[]; reassignmentsRequired: { username: string; workerId: string }[] };
    let outcome: NormalAssignmentOutcome | undefined;
    try {
      const databaseSession = await Assignment.startSession();
      try {
        outcome = await databaseSession.withTransaction(async () => {
          const worker = await User.findOne({ _id: workerId, role: 'worker', workspaceId, status: 'active' })
            .select('_id').session(databaseSession).lean();
          if (!worker) return { type: 'worker-not-found' } as const;

          const conflicts = await Assignment.find({ workspaceId, status: 'active', username: { $in: normalizedUsernames } })
            .select('username workerId').session(databaseSession).lean();
          const currentByUsername = new Map(conflicts.map((assignment) => [assignment.username.toLowerCase(), assignment.workerId]));
          const duplicates = usernames.filter((username) => currentByUsername.has(username.toLowerCase()));
          const reassignmentsRequired = usernames.flatMap((username) => {
            const currentWorkerId = currentByUsername.get(username.toLowerCase());
            return currentWorkerId && currentWorkerId !== workerId ? [{ username: username.toLowerCase(), workerId: currentWorkerId }] : [];
          });
          const accepted = usernames.filter((username) => !currentByUsername.has(username.toLowerCase()));
          if (!accepted.length) return { type: 'no-accepted', duplicates, reassignmentsRequired } as const;

          const batchId = randomUUID();
          const created = await Assignment.insertMany(accepted.map((username) => ({
            workspaceId, workerId, assignedBy: session.id, username: username.toLowerCase(), status: 'active', lastStopTime: stopTimeValue,
            assignmentBatch: batchId, assignmentDate: new Date(),
          })), { ordered: true, session: databaseSession });
          await AuditLog.create([{
            workspaceId,
            actorId: session.id,
            actorRole: session.role,
            action: 'assignments.created',
            resourceType: 'assignment_batch',
            resourceId: batchId,
            details: { workerId, inserted: created.length, duplicates },
          }], { session: databaseSession });
          return { type: 'created', batchId, inserted: created.length, duplicates, reassignmentsRequired } as const;
        });
      } finally {
        await databaseSession.endSession();
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        return NextResponse.json({ message: 'An assignment changed during this request. Refresh assignments and try again.' }, { status: 409 });
      }
      return NextResponse.json({ message: 'Assignment batch could not be saved. Verify that MongoDB transactions are available.' }, { status: 500 });
    }

    if (!outcome || outcome.type === 'worker-not-found') return NextResponse.json({ message: 'Active worker not found in this workspace.' }, { status: 404 });
    if (outcome.type === 'no-accepted') {
      if (outcome.reassignmentsRequired.length) {
        return NextResponse.json({
          message: 'Confirm before reassigning usernames already assigned to another Worker.',
          requiresOverrideConfirmation: true,
          inserted: 0,
          duplicates: outcome.duplicates,
          reassignmentsRequired: outcome.reassignmentsRequired,
        }, { status: 409 });
      }
      return NextResponse.json({ message: 'All usernames are already actively assigned in this workspace.', inserted: 0, duplicates: outcome.duplicates }, { status: 409 });
    }
    return NextResponse.json({ success: true, ...outcome }, { status: 201 });
  }

  type Reassignment = { username: string; workerId: string };
  type Outcome =
    | { type: 'worker-not-found' }
    | { type: 'completed'; batchId: string; inserted: number; duplicates: string[]; reassigned: string[]; reassignmentsRequired: Reassignment[] };
  class AssignmentStateConflict extends Error {}

  let databaseSession: Awaited<ReturnType<typeof Assignment.startSession>> | null = null;
  let outcome: Outcome | undefined;
  try {
    databaseSession = await Assignment.startSession();
    const transactionSession = databaseSession;
    outcome = await transactionSession.withTransaction(async () => {
      const worker = await User.findOne({ _id: workerId, role: 'worker', workspaceId, status: 'active' })
        .select('_id').session(transactionSession).lean();
      if (!worker) return { type: 'worker-not-found' } as const;

      const activeAssignments = await Assignment.find({ workspaceId, status: 'active', username: { $in: normalizedUsernames } })
        .select('_id workerId username').session(transactionSession).lean();
      const byUsername = new Map<string, typeof activeAssignments>();
      for (const assignment of activeAssignments) {
        const normalizedUsername = assignment.username.toLowerCase();
        byUsername.set(normalizedUsername, [...(byUsername.get(normalizedUsername) || []), assignment]);
      }
      const duplicates = usernames.filter((username) => byUsername.has(username.toLowerCase()));
      const oldAssignments: { username: string; workerId: string; assignmentId: unknown }[] = [];
      for (const username of usernames) {
        const normalizedUsername = username.toLowerCase();
        const matches = byUsername.get(normalizedUsername) || [];
        const expectedWorkerId = expectedAssignments.get(normalizedUsername);
        if (matches.length !== 1 || !expectedWorkerId || matches[0].workerId !== expectedWorkerId || matches[0].workerId === workerId) {
          throw new AssignmentStateConflict('Assignment changed after confirmation.');
        }
        oldAssignments.push({ username: normalizedUsername, workerId: matches[0].workerId, assignmentId: matches[0]._id });
      }

      for (const previous of oldAssignments) {
        const update = await Assignment.updateOne(
          { _id: previous.assignmentId, workspaceId, workerId: previous.workerId, status: 'active' },
          { $set: { status: 'inactive' } },
          { session: transactionSession },
        );
        if (update.matchedCount !== 1 || update.modifiedCount !== 1) throw new AssignmentStateConflict('Assignment changed during reassignment.');
      }

      const batchId = randomUUID();
      await Assignment.insertMany(usernames.map((username) => ({
        workspaceId, workerId, assignedBy: session.id, username: username.toLowerCase(), status: 'active', lastStopTime: stopTimeValue,
        assignmentBatch: batchId, assignmentDate: new Date(),
      })), { session: transactionSession, ordered: true });
      await AuditLog.create([{
        workspaceId,
        actorId: session.id,
        actorRole: session.role,
        action: 'assignments.reassigned',
        resourceType: 'assignment_batch',
        resourceId: batchId,
        details: { workerId, reassigned: oldAssignments.map(({ username, workerId: previousWorkerId }) => ({ username, fromWorkerId: previousWorkerId, toWorkerId: workerId })) },
      }], { session: transactionSession });
      return { type: 'completed', batchId, inserted: usernames.length, duplicates, reassigned: usernames.map((username) => username.toLowerCase()), reassignmentsRequired: [] } as const;
    });
  } catch (error) {
    if (error instanceof AssignmentStateConflict) return NextResponse.json({ message: error.message, refreshAssignments: true }, { status: 409 });
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      return NextResponse.json({ message: 'An assignment changed during this request. Refresh assignments and try again.' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Assignment could not be saved. Verify that MongoDB transactions are available.' }, { status: 500 });
  } finally {
    if (databaseSession) await databaseSession.endSession();
  }

  if (!outcome) return NextResponse.json({ message: 'Assignment transaction did not return a result.' }, { status: 500 });
  if (outcome.type === 'worker-not-found') return NextResponse.json({ message: 'Active worker not found in this workspace.' }, { status: 404 });
  return NextResponse.json({ success: true, ...outcome }, { status: outcome.reassigned.length ? 200 : 201 });
}
