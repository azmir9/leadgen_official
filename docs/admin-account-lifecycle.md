# Admin account lifecycle

## Status and activity

`User.status` remains the authorization state: `active` is login-enabled, `inactive` is disabled, `blocked` is explicitly blocked, and `deleted` is soft-deleted. The normal Admin API derives the displayed presence status separately. An enabled Admin is displayed as active when they have a non-revoked, unexpired server session with the current session version, or recent authenticated activity newer than `lastLoggedOutAt`. Otherwise they are displayed as inactive. `lastActiveAt` is updated by authenticated Admin requests at most once per minute. The recent-activity threshold is `ADMIN_INACTIVITY_MINUTES` (1–1440); invalid or missing values use 15 minutes.

Blocking and soft deletion increment `sessionVersion` and revoke active server sessions in the same transaction as the status change and audit event. Blocking also revokes the Admin's active joining links. Unblocking sets the account back to login-enabled but does not issue or restore a session; presence remains inactive until a valid session/activity is observed.

## Soft deletion and permanent-delete blocker

Soft deletion sets `status: deleted`, `deletedAt`, `deletedBy`, and `deletionPreviousStatus`. It revokes sessions and joining links, removes the Admin from normal lists, and preserves the User identity for the Super Admin-only Admin History view. Workspaces and all associated business records remain untouched.

Permanent deletion is deliberately blocked pending an approved retention/anonymization policy. The schema stores Admin identifiers in `Workspace.adminId`, `JoinLink.adminId`, `Assignment.assignedBy`, `OfficialReport.uploadedBy`, `UserOrder.deliveryHistory.deliveredBy`, `DailyRate.setBy`, `Payment.clearedBy` and `Payment.paymentHistory.recordedBy`, `Interview.reviewedBy` / `resetBy` / history, and `AuditLog.actorId`. Deleting the User document would detach these retained records from a known actor; cascading their deletion could damage financial calculations and audit history. The permanent-delete endpoint therefore validates the request and returns an explicit conflict without changing any records. History remains Super Admin-only until a retention policy and safe anonymization strategy are approved and implemented.
