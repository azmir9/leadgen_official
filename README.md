# Leadgen Official

Multi-workspace lead operations and company marketing platform built with Next.js 16, TypeScript, MongoDB, and Mongoose.

## Local Setup

1. Copy `.env.example` to `.env.local` and configure `MONGODB_URI`, `JWT_SECRET`, `BOOTSTRAP_SECRET`, `SUPER_ADMIN_NAME`, `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_EMAIL`, and `SUPER_ADMIN_PASSWORD`. The bootstrap password must be at least 12 characters. `.env.local` is gitignored. Never put production credentials in tracked files.
   Keep `SUPER_ADMIN_USERNAME` configured in the deployed runtime and matched to the active Super Admin account created by bootstrap. Public Worker registration uses this identity to resolve its owner Workspace and fails closed if the account or its active Workspace cannot be verified.
2. Set `APP_URL` to the canonical public site URL. For local use, `http://localhost:3000` is suitable.
3. Before bootstrap or production traffic, have an operator initialize and verify the required indexes through a separately reviewed maintenance process. Production `connectDB()` does not initialize indexes, and `package.json` currently has no dedicated index-initialization command. The explicit `ensureDatabaseIndexes()` utility preflights duplicate keys and then calls Mongoose `createIndexes()` for all declared models; it changes database index state when invoked. Follow the read-only preparation and approval process in [the index initialization runbook](docs/database-index-initialization-runbook.md). Do not run the utility against an existing database until its current indexes and duplicate data have been reviewed and any required migration is approved.
4. Use a MongoDB replica-set deployment for bootstrap and application workflows that require transactions. Bootstrap now creates the Super Admin, owner Workspace, and Workspace assignment in one transaction; it fails closed if transactions are unavailable.
5. Install packages with `npm install` and start the server using `npm run dev`.
6. Create the company owner account and owner workspace once:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/setup/bootstrap -Headers @{ 'x-bootstrap-secret' = '<your BOOTSTRAP_SECRET>' }
```

7. Sign in at `/login`. Create Admins from the Super Admin panel, issue their worker invitations, then review new registrations from that Admin's workspace.

The bootstrap endpoint is `POST /api/setup/bootstrap` and requires the configured `BOOTSTRAP_SECRET` in the `x-bootstrap-secret` header. It returns `409` after setup has completed or if the configured account conflicts with an existing account. It never initializes a known default password. Do not rerun bootstrap casually: first confirm whether setup completed. If it returns `500`, do not retry blindly. The route logs only a failure phase, standard error name, and numeric database error code when available; it omits error messages, stack traces, request headers, and configuration values. Correlate that diagnostic with the request time, check only whether required configuration is present, and have an operator inspect setup state read-only before any recovery action. Never log credentials, hashes, tokens, or connection strings.

## Email Reset Setup

Password reset uses Resend. Configure `RESEND_API_KEY` and a verified `EMAIL_FROM` sender domain. Reset links expire after 30 minutes, are single-use, and are stored only as SHA-256 token hashes. Without those settings the reset endpoint returns `503`; it does not return reset tokens or expose account existence.

## Data Safety And Indexes

Schema declarations do not prove that indexes exist in a database. Normal application startup does not call `ensureDatabaseIndexes()`. `connectDB()` enables Mongoose automatic index creation only when `MONGOOSE_AUTO_INDEX` is exactly `true`; otherwise it is disabled. Do not set it to `true` for a production or existing database without an approved index plan. The explicit utility checks duplicate data for required unique keys, then calls `createIndexes()` for all declared model indexes; it does not drop or synchronize indexes. A pre-existing index with incompatible options can still prevent creation, and duplicate data can prevent a unique index.

`MONGOOSE_AUTO_INDEX` is enabled only when set to the exact string `true`; unset or `false` disables it in both development and production. This setting does not check, create, or verify missing indexes.

Required unique indexes include User `username` and `email`; the partial unique User `role` index for `super-admin`; Workspace `adminId`; active Assignment `workspaceId + username`; OfficialReport and LeadApproval workspace/date/username keys; JoinLink, PasswordReset, and AuthSession token hashes; DailyRate workspace/effective date; active PaymentAllocation workspace/worker/date; Interview workspace/worker/service; CmsContent type/slug; and RateLimitBucket key/bucket. Other ordinary, text, compound, and TTL indexes are declared in `src/lib/models.ts` as well.

For a new database, an operator must use an approved, controlled process to initialize indexes, verify them with a read-only listing, and only then expose bootstrap or application traffic. There is no packaged command for that process yet; do not substitute normal application startup. For an existing database, first inspect index definitions and duplicate data read-only, take a verified backup, and approve a separate migration for conflicts. Never drop or replace an index automatically. The `unique_super_admin_role` schema declaration protects concurrent bootstrap only after that index has been initialized and verified; it is not yet a claim about any live database. The runbook documents these gates without providing or executing a production-changing command.

MongoDB transactions are required for finalizing and voiding payments. Use MongoDB Atlas or another replica-set deployment; standalone MongoDB cannot provide atomic payment allocation transactions.

Bootstrap and workspace creation also require transaction support. If bootstrap fails, the transaction should abort all setup writes together. If transaction support or index readiness is uncertain, stop and diagnose using sanitized logs and read-only database inspection. Do not manually delete users or workspaces or rerun bootstrap without an approved recovery plan.

## Implemented Workflows

- Super Admin bootstrap, Admin/workspace creation, status changes, scoped inspection, invitation rotation/revocation/expiry, global branding, CMS, and audit views.
- Worker registration routes public users to the owner workspace and invitation users to the issuing Admin workspace. New accounts require approval and receive no session during registration.
- Admin worker search/status/date filtering and pagination, assignment duplicate checks, partial order delivery history, official report preview/import/correction auditing, lead approval/rejection, effective-dated rates, payment clearance, and interview review/reset.
- Payment records preserve the final rate/approval/adjustment breakdown. A unique active allocation index prevents the same worker/date from being paid twice. Workers see only their own records; Admin reads are workspace-scoped; Super Admin can inspect global history.
- Worker screens show personal assignments, date-selected reports, orders, payment history, profile fields, and service interviews. Missing reports are displayed separately from numeric zero.
- Opaque random database-backed sessions, 30-day Remember Me, live role/status/workspace checks, session revocation, Mongo-backed auth rate limits, and single-use password reset.
- Super Admin CMS manages published/draft/scheduled blog posts, services, free services, offers, banners, and page content with slugs/images/alt text/SEO metadata and archive history.
- Public Privacy Policy and Terms pages, dynamic content metadata, sitemap, robots exclusions, and noindex metadata on auth/dashboard pages.

## Checks

```powershell
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Integration tests use an isolated `mongodb-memory-server` replica set and never use `.env.local` or Atlas. They test owner bootstrap, login/Remember Me, Admin/workspace isolation, public and invitation registration, invitation revocation/expiry, worker approval/blocking, assignments, partial orders, report correction/date isolation, lead approvals/rates, duplicate-safe payment clearance, interviews/reset, CMS authorization/edit/archive, global branding permissions, reset-token single use, rate limits, and global payment access.

## Still Requires Manual Configuration/Review

- Configure valid production MongoDB, `APP_URL`, JWT/bootstrap secrets, and Resend sender credentials.
- Review privacy/terms wording for the legal entity, applicable jurisdiction, retention duties, and actual provider list before publication.
- Review existing production duplicate records if the new unique-index preflight reports any; no automatic cleanup is performed.
- Configure a verified payment-transfer process externally. The app records clearances and Admin-reported paid status; it does not initiate bKash, Nagad, or Rocket transfers.
