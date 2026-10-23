import type { Model } from 'mongoose';
import {
  Assignment,
  AuditLog,
  AuthSession,
  CmsContent,
  CompanySettings,
  DailyRate,
  Interview,
  JoinLink,
  LeadApproval,
  OfficialReport,
  OfficialReportHistory,
  Payment,
  PaymentAllocation,
  PasswordReset,
  RateLimitBucket,
  User,
  UserOrder,
  Workspace,
} from '@/lib/models';

type UniqueIndexCheck = { model: Model<unknown>; fields: string[]; match?: Record<string, unknown> };

const uniqueIndexChecks: UniqueIndexCheck[] = [
  { model: User, fields: ['username'] },
  { model: User, fields: ['email'] },
  { model: User, fields: ['role'], match: { role: 'super-admin' } },
  { model: Workspace, fields: ['adminId'] },
  { model: Assignment, fields: ['workspaceId', 'username'], match: { status: 'active' } },
  { model: OfficialReport, fields: ['workspaceId', 'reportDate', 'normalizedUsername'] },
  { model: JoinLink, fields: ['tokenHash'] },
  { model: LeadApproval, fields: ['workspaceId', 'reportDate', 'normalizedUsername'] },
  { model: DailyRate, fields: ['workspaceId', 'effectiveDate'] },
  { model: PaymentAllocation, fields: ['workspaceId', 'workerId', 'reportDate'], match: { status: 'active' } },
  { model: Interview, fields: ['workspaceId', 'workerId', 'service'] },
  { model: CmsContent, fields: ['type', 'slug'] },
  { model: PasswordReset, fields: ['tokenHash'] },
  { model: AuthSession, fields: ['tokenHash'] },
  { model: RateLimitBucket, fields: ['key', 'bucket'] },
];

const models: Model<unknown>[] = [
  User, Workspace, CompanySettings, Assignment, UserOrder, OfficialReport, OfficialReportHistory, JoinLink,
  AuditLog, LeadApproval, DailyRate, Payment, PaymentAllocation, Interview,
  CmsContent, PasswordReset, AuthSession, RateLimitBucket,
];

let indexesReady = false;
let indexPromise: Promise<void> | null = null;

export async function ensureDatabaseIndexes() {
  if (indexesReady) return;
  if (!indexPromise) {
    indexPromise = (async () => {
      for (const check of uniqueIndexChecks) {
        const id = Object.fromEntries(check.fields.map((field) => [field, `$${field}`]));
        const duplicates = await check.model.collection.aggregate([
          ...(check.match ? [{ $match: check.match }] : []),
          { $group: { _id: id, count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
          { $limit: 3 },
        ]).toArray();
        if (duplicates.length) {
          throw new Error(`Cannot create unique index for ${check.model.modelName} (${check.fields.join(', ')}): duplicate records already exist. Resolve the duplicates using an explicit data migration; no existing records were changed.`);
        }
      }

      await Promise.all(models.map((model) => model.createIndexes()));
      indexesReady = true;
    })().catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  await indexPromise;
}
