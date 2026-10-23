import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/db';
import { User, Workspace } from '@/lib/models';

export async function POST(request: Request) {
  const expectedSecret = process.env.BOOTSTRAP_SECRET;
  const suppliedSecret = request.headers.get('x-bootstrap-secret') || '';

  if (!expectedSecret) {
    return NextResponse.json({ message: 'Bootstrap is not configured.' }, { status: 503 });
  }

  const expected = Buffer.from(expectedSecret);
  const supplied = Buffer.from(suppliedSecret);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ message: 'Not authorized.' }, { status: 401 });
  }

  const name = process.env.SUPER_ADMIN_NAME?.trim();
  const username = process.env.SUPER_ADMIN_USERNAME?.trim().toLowerCase();
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!name || !username || !email || !password || password.length < 12) {
    return NextResponse.json({ message: 'Set the Super Admin name, username, email, and a 12+ character password in the environment.' }, { status: 503 });
  }

  let failurePhase = 'database-connection';
  try {
    await connectDB();
    failurePhase = 'password-hashing';
    const passwordHash = await bcrypt.hash(password, 12);
    failurePhase = 'database-transaction';
    const databaseSession = await User.startSession();
    try {
      const outcome = await databaseSession.withTransaction(async () => {
        const existingSuperAdmin = await User.findOne({ role: 'super-admin' })
          .session(databaseSession)
          .select('_id')
          .lean();
        if (existingSuperAdmin) {
          return 'already-completed' as const;
        }

        const existingAccount = await User.findOne({ $or: [{ username }, { email }] })
          .session(databaseSession)
          .select('_id')
          .lean();
        if (existingAccount) {
          return 'account-conflict' as const;
        }

        const [user] = await User.create([{
          name,
          username,
          email,
          passwordHash,
          role: 'super-admin',
          status: 'active',
          workspaceId: null,
        }], { session: databaseSession });

        const [workspace] = await Workspace.create([{
          name: 'Leadgen Official',
          adminId: String(user._id),
          description: 'Company owner workspace',
        }], { session: databaseSession });

        const assignment = await User.updateOne(
          { _id: user._id },
          { $set: { workspaceId: String(workspace._id) } },
          { session: databaseSession },
        );
        if (assignment.matchedCount !== 1) {
          throw new Error('Unable to link the Super Admin account to its Workspace.');
        }
        return 'created' as const;
      });

      if (outcome === 'already-completed') {
        return NextResponse.json({ message: 'Super Admin setup has already been completed.' }, { status: 409 });
      }
      if (outcome === 'account-conflict') {
        return NextResponse.json({ message: 'The configured Super Admin account conflicts with an existing account.' }, { status: 409 });
      }

      return NextResponse.json({ success: true, message: 'Super Admin and company workspace created. Sign in using the configured credentials.' }, { status: 201 });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        return NextResponse.json({ message: 'Super Admin setup has already been completed or the configured account conflicts with an existing account.' }, { status: 409 });
      }
      throw error;
    } finally {
      await databaseSession.endSession();
    }
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
      ? error.code
      : undefined;
    console.error('[bootstrap] Initial setup failed.', {
      phase: failurePhase,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode,
    });
    return NextResponse.json({ message: 'Unable to complete initial setup.' }, { status: 500 });
  }
}
