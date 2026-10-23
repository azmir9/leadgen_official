import mongoose from 'mongoose';

export interface IUserDocument {
  _id?: string;
  name: string;
  username: string;
  email: string;
  passwordHash: string;
  role: 'super-admin' | 'admin' | 'worker';
  workspaceId?: string | null;
  phone?: string;
  whatsapp?: string;
  facebook?: string;
  telegram?: string;
  paymentAccounts?: Record<string, string>;
  sessionVersion?: number;
  lastActiveAt?: Date | null;
  lastLoggedOutAt?: Date | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  deletionPreviousStatus?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  approvalRequired?: boolean;
  primaryInterviewService?: string | null;
  onboardingTokenHash?: string | null;
  onboardingTokenExpiresAt?: Date | null;
  status: 'pending' | 'active' | 'inactive' | 'blocked' | 'deleted';
  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = new mongoose.Schema<IUserDocument>(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['super-admin', 'admin', 'worker'], default: 'worker', required: true },
    workspaceId: { type: String, default: null, index: true },
    phone: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    facebook: { type: String, default: '' },
    telegram: { type: String, default: '' },
    paymentAccounts: { type: mongoose.Schema.Types.Mixed, default: {} },
    sessionVersion: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: null },
    lastLoggedOutAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },
    deletionPreviousStatus: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    approvalRequired: { type: Boolean, default: false },
    primaryInterviewService: { type: String, default: null },
    onboardingTokenHash: { type: String, default: null, select: false },
    onboardingTokenExpiresAt: { type: Date, default: null, select: false },
    status: { type: String, enum: ['pending', 'active', 'inactive', 'blocked', 'deleted'], default: 'pending' },
  },
  { timestamps: true },
);

UserSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: 'super-admin' }, name: 'unique_super_admin_role' },
);

export const User = mongoose.models.User || mongoose.model('User', UserSchema);

const WorkspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    adminId: { type: String, required: true },
    description: String,
    isActive: { type: Boolean, default: true },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

WorkspaceSchema.index({ adminId: 1 }, { unique: true });

export const Workspace = mongoose.models.Workspace || mongoose.model('Workspace', WorkspaceSchema);

const CompanySettingsSchema = new mongoose.Schema(
  {
    companyName: { type: String, default: 'Leadgen Official' },
    ownerName: { type: String, default: 'Leadgen Official Owner' },
    logoUrl: { type: String, default: '' },
    description: { type: String, default: 'Professional digital marketing and lead generation services.' },
    contactEmail: { type: String, default: 'hello@leadgenofficial.com' },
    contactPhone: { type: String, default: '+8801700000000' },
    telegramLink: { type: String, default: 'https://t.me/leadgenofficial' },
    whatsappLink: { type: String, default: 'https://wa.me/8801700000000' },
    facebookLink: { type: String, default: 'https://facebook.com/leadgenofficial' },
    websiteUrl: { type: String, default: 'https://leadgenofficial.com' },
    announcement: { type: String, default: 'Welcome to Leadgen Official.' },
    theme: { type: String, default: 'default' },
  },
  { timestamps: true },
);

export const CompanySettings = mongoose.models.CompanySettings || mongoose.model('CompanySettings', CompanySettingsSchema);

const AssignmentSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    workerId: { type: String, required: true, index: true },
    assignedBy: { type: String, required: true },
    username: { type: String, required: true, trim: true },
    status: { type: String, default: 'active' },
    lastStopTime: { type: Date, default: null },
    assignmentBatch: { type: String, default: 'default' },
    assignmentDate: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

AssignmentSchema.index(
  { workspaceId: 1, username: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

export const Assignment = mongoose.models.Assignment || mongoose.model('Assignment', AssignmentSchema);

const UserOrderSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    workerId: { type: String, required: true, index: true },
    requestedQuantity: { type: Number, required: true, min: 1 },
    deliveredQuantity: { type: Number, default: 0 },
    pendingQuantity: { type: Number, default: 0 },
    status: { type: String, default: 'pending' },
    requestDate: { type: Date, default: Date.now },
    deliveryHistory: {
      type: [{ quantity: { type: Number, required: true }, deliveredBy: { type: String, required: true }, deliveredAt: { type: Date, required: true }, cumulativeDelivered: { type: Number, required: true } }],
      default: [],
    },
  },
  { timestamps: true },
);

export const UserOrder = mongoose.models.UserOrder || mongoose.model('UserOrder', UserOrderSchema);

const OfficialReportSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    reportDate: { type: String, required: true },
    normalizedUsername: { type: String, required: true },
    reportValue: { type: Number, required: true },
    uploadedBy: { type: String, required: true },
  },
  { timestamps: true },
);

OfficialReportSchema.index({ workspaceId: 1, reportDate: 1, normalizedUsername: 1 }, { unique: true });
export const OfficialReport = mongoose.models.OfficialReport || mongoose.model('OfficialReport', OfficialReportSchema);

const OfficialReportHistorySchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    reportId: { type: String, required: true, index: true },
    reportDate: { type: String, required: true },
    normalizedUsername: { type: String, required: true },
    previousValue: { type: Number, required: true },
    nextValue: { type: Number, required: true },
    changedBy: { type: String, required: true },
    changedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false, versionKey: false },
);

OfficialReportHistorySchema.index({ workspaceId: 1, reportDate: 1, normalizedUsername: 1, changedAt: -1 });
export const OfficialReportHistory = mongoose.models.OfficialReportHistory || mongoose.model('OfficialReportHistory', OfficialReportHistorySchema);

const JoinLinkSchema = new mongoose.Schema(
  {
    adminId: { type: String, required: true },
    workspaceId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    tokenCiphertext: { type: String, required: true },
    status: { type: String, enum: ['active', 'revoked', 'expired'], default: 'active' },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

JoinLinkSchema.index({ tokenHash: 1 }, { unique: true });

export const JoinLink = mongoose.models.JoinLink || mongoose.model('JoinLink', JoinLinkSchema);

const AuditLogSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, default: null, index: true },
    actorId: { type: String, required: true, index: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);

const LeadApprovalSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    workerId: { type: String, required: true, index: true },
    reportDate: { type: String, required: true },
    normalizedUsername: { type: String, required: true },
    officialReportValue: { type: Number, required: true, min: 0 },
    approvedLeads: { type: Number, required: true, min: 0 },
    rejectedLeads: { type: Number, required: true, min: 0 },
    adjustmentAmount: { type: Number, default: 0 },
    adjustmentReason: { type: String, default: '' },
    reviewedBy: { type: String, required: true },
    reviewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

LeadApprovalSchema.index({ workspaceId: 1, reportDate: 1, normalizedUsername: 1 }, { unique: true });
LeadApprovalSchema.index({ workspaceId: 1, workerId: 1, reportDate: 1 });
export const LeadApproval = mongoose.models.LeadApproval || mongoose.model('LeadApproval', LeadApprovalSchema);

const DailyRateSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    effectiveDate: { type: String, required: true },
    ratePerLead: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'BDT', uppercase: true },
    setBy: { type: String, required: true },
  },
  { timestamps: true },
);

DailyRateSchema.index({ workspaceId: 1, effectiveDate: 1 }, { unique: true });
export const DailyRate = mongoose.models.DailyRate || mongoose.model('DailyRate', DailyRateSchema);

const PaymentSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    workerId: { type: String, required: true, index: true },
    paymentMethod: { type: String, enum: ['bKash', 'Nagad', 'Rocket', 'Bank Transfer', 'Cash'], required: true },
    accountSnapshot: { type: String, required: true },
    transactionReference: { type: String, default: '' },
    currency: { type: String, required: true, default: 'BDT' },
    grossAmount: { type: Number, required: true, min: 0 },
    adjustmentTotal: { type: Number, required: true, default: 0 },
    payableAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    allocations: {
      type: [{
        reportDate: { type: String, required: true },
        approvedLeads: { type: Number, required: true, min: 0 },
        ratePerLead: { type: Number, required: true, min: 0 },
        adjustmentAmount: { type: Number, required: true },
        adjustmentReason: { type: String, default: '' },
        amount: { type: Number, required: true },
      }],
      required: true,
    },
    paymentHistory: {
      type: [{ amount: { type: Number, required: true, min: 0 }, transactionReference: { type: String, default: '' }, recordedBy: { type: String, required: true }, recordedAt: { type: Date, required: true } }],
      default: [],
    },
    status: { type: String, enum: ['cleared', 'partially_paid', 'paid', 'void'], default: 'cleared', index: true },
    clearedBy: { type: String, required: true },
    paidAt: { type: Date, default: null },
    finalizedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

PaymentSchema.index({ workspaceId: 1, workerId: 1, createdAt: -1 });
export const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);

const PaymentAllocationSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true },
    workerId: { type: String, required: true },
    reportDate: { type: String, required: true },
    paymentId: { type: String, required: true, index: true },
    createdBy: { type: String, required: true },
    status: { type: String, enum: ['active', 'void'], default: 'active' },
  },
  { timestamps: true },
);

PaymentAllocationSchema.index({ workspaceId: 1, workerId: 1, reportDate: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
export const PaymentAllocation = mongoose.models.PaymentAllocation || mongoose.model('PaymentAllocation', PaymentAllocationSchema);

const InterviewSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, index: true },
    workerId: { type: String, required: true, index: true },
    service: { type: String, enum: ['lead-generation', 'facebook-marketing', 'youtube-marketing', 'google-ads', 'seo', 'google-seo', 'social-media-marketing', 'telegram-marketing', 'other-freelancing'], required: true },
    category: { type: String, default: null },
    experienceAmount: { type: Number, min: 0, max: 1000, default: null },
    experienceUnit: { type: String, enum: ['months', 'years', null], default: null },
    dailyLeadCapacity: { type: Number, min: 0, default: null },
    workArrangement: { type: String, enum: ['individual', 'team', null], default: null },
    platforms: { type: [String], default: [] },
    description: { type: String, default: '', maxlength: 5000 },
    contact: { type: mongoose.Schema.Types.Mixed, default: {} },
    answers: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['submitted', 'pending_review', 'reviewed', 'approved', 'reset'], default: 'submitted', index: true },
    submittedAt: { type: Date, required: true, default: Date.now },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    resetBy: { type: String, default: null },
    resetAt: { type: Date, default: null },
    history: {
      type: [{
        answers: mongoose.Schema.Types.Mixed, category: String, experienceAmount: Number, experienceUnit: String,
        dailyLeadCapacity: Number, workArrangement: String, platforms: [String], description: String,
        contact: mongoose.Schema.Types.Mixed, submittedAt: Date, reviewedAt: Date, reviewedBy: String, revision: Number,
      }],
      default: [],
    },
    revision: { type: Number, default: 1 },
  },
  { timestamps: true },
);

InterviewSchema.index({ workspaceId: 1, workerId: 1, service: 1 }, { unique: true });
export const Interview = mongoose.models.Interview || mongoose.model('Interview', InterviewSchema);

const CmsContentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['blog', 'service', 'free-service', 'offer', 'banner', 'page'], required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    summary: { type: String, default: '', maxlength: 500 },
    content: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    imageAlt: { type: String, default: '' },
    seoTitle: { type: String, default: '' },
    seoDescription: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
    publishAt: { type: Date, default: null },
    createdBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CmsContentSchema.index({ type: 1, slug: 1 }, { unique: true });
CmsContentSchema.index({ status: 1, publishAt: 1, type: 1 });
CmsContentSchema.index({ title: 'text', summary: 'text', content: 'text' });
export const CmsContent = mongoose.models.CmsContent || mongoose.model('CmsContent', CmsContentSchema);

const PasswordResetSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const PasswordReset = mongoose.models.PasswordReset || mongoose.model('PasswordReset', PasswordResetSchema);

const AuthSessionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    sessionVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
    rememberMe: { type: Boolean, default: false },
  },
  { timestamps: true },
);

AuthSessionSchema.index({ userId: 1, revokedAt: 1 });
export const AuthSession = mongoose.models.AuthSession || mongoose.model('AuthSession', AuthSessionSchema);

const RateLimitBucketSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    bucket: { type: Number, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

RateLimitBucketSchema.index({ key: 1, bucket: 1 }, { unique: true });
export const RateLimitBucket = mongoose.models.RateLimitBucket || mongoose.model('RateLimitBucket', RateLimitBucketSchema);
