# Controlled database index initialization runbook

This runbook is a preparation and approval process. It does not establish that any live database is ready, and it does not authorize an index change by itself. No production index command is packaged in this project. Do not run bootstrap or expose application traffic until the approved operator process is complete.

## What the current code does

- Production `connectDB()` disables Mongoose automatic index creation. Normal application startup does not call `ensureDatabaseIndexes()`.
- The explicit utility in `src/lib/migrations.ts` checks duplicate values for its listed required unique keys, then invokes `createIndexes()` on **all 17 declared models**. It does not call `dropIndexes()` or `syncIndexes()`, and it does not modify documents. Calling `createIndexes()` can create indexes and can fail if an index with an incompatible definition already exists.
- The preflight checks detect duplicate key values, including duplicate `role: 'super-admin'` values. They do not compare every existing index's key/options with every desired schema definition, nor do they assess operational load or cluster readiness.
- `User` declares a partial unique index on `{ role: 1 }` with filter `{ role: 'super-admin' }` named `unique_super_admin_role`. `Workspace.adminId` is declared unique. Schema declarations alone do not show what exists on a live database.

## Operator procedure

### 1. Identify and approve the target

1. Obtain a change ticket naming the environment (for example, staging or production), service, cluster/project identifier, intended database name, maintenance window, and accountable operator/reviewer.
2. Match the target using the deployment control plane or secret-manager entry **by its non-secret identifier**. Do not paste, print, screenshot, or place a URI, password, token, or secret value in the ticket, terminal transcript, or chat. Do not use a local `.env` file as evidence of the production target.
3. Have a second authorized person confirm the environment and database name from the approved administrative console before any database action.

If the target cannot be identified unambiguously, stop.

### 2. Confirm topology and transaction readiness read-only

Using the organization's approved database administration console and a read-only account, inspect the deployment topology and server version. Confirm that the deployment is a replica set or supported sharded cluster, and confirm transaction support for the actual deployment/version with the database administrator. A standalone server does not support the application's multi-document transactions. Do not infer transaction support from the application configuration or a successful connection.

If topology, server compatibility, or transaction support is uncertain or unsuitable, stop and escalate. Do not test by invoking bootstrap or writing a transaction.

### 3. Inspect only relevant records and indexes

Use read-only queries in the approved administrative console, scoped to the selected database and collections:

- For `User`, retrieve only the count of documents whose role is `super-admin`; do not display usernames, email addresses, password hashes, or complete documents.
- Retrieve a count grouped by role `super-admin` and report only whether the count is zero, one, or greater than one. If greater than one, record that duplicate Super Admin records exist without exporting their identities.
- For `User` and `Workspace`, inspect collection index definitions only (equivalent to `listIndexes()`): key pattern, index name, `unique`, `partialFilterExpression`, and other options relevant to the required indexes. Do not dump unrelated collections or documents.
- Compare the current definitions with the source declarations for User `username`, `email`, and the partial unique `role` index, plus Workspace `adminId`. Check for an existing same-key index with incompatible uniqueness or partial-filter options, an index-name collision with a different key/options, or any other definition that MongoDB will not accept alongside the requested index.

The intended role index is exactly on `{ role: 1 }`, unique, with `partialFilterExpression: { role: 'super-admin' }`, named `unique_super_admin_role`. The Workspace owner index is unique on `{ adminId: 1 }`. An ordinary non-unique `{ role: 1 }` index does not enforce the single-Super-Admin constraint. Do not assume that either intended index exists until its definition is observed in the target database.

If duplicate Super Admin records or a conflicting index are found, stop. Do not delete or edit records, or drop/replace an index, to make initialization pass. Prepare a separately reviewed migration proposal and obtain explicit approval.

### 4. Approve backup and any required migration

Before any index-changing activity, obtain an approved backup/snapshot for the exact target and verify that the responsible operator can identify its completion and recovery procedure. If a data cleanup or index replacement is required, document the proposed changes, affected records/indexes, rollback strategy, expected impact, and maintenance window. Obtain explicit database-owner approval for that migration separately. This repository's preflight is a guard, not approval and not a cleanup mechanism.

No existing record or index should be deleted automatically: the code cannot determine business ownership or whether an index serves an unobserved workload. Automatic cleanup could destroy account/workspace state or remove query/performance constraints.

### 5. Select a narrowly scoped initialization method

Do not invoke `ensureDatabaseIndexes()` casually on an existing database: after its duplicate preflight it calls `createIndexes()` for every declared model, so it may create unrelated missing indexes as well as the one under review. It does not synchronize/drop indexes, but its broad scope is still broader than a focused maintenance change.

The safest approach for an existing deployment is to approve a narrowly scoped, separately reviewed operation that addresses only the indexes required for the approved change, after the preflight and backup gates above. If the goal is full initialization on a genuinely new empty database, the broad utility may be considered only after its complete model index inventory is reviewed and the operator explicitly accepts creating all declared indexes. There is currently no dedicated command for either operation. Do not add or run a production-changing command as part of this runbook; obtain separate approval and implementation review first.

### 6. Verify and release

After an approved initialization, use the same read-only index listing to verify the exact key, name, uniqueness, and partial filter for `unique_super_admin_role`, and the unique `{ adminId: 1 }` Workspace index. Verify other indexes only to the extent required by the approved change. Record the sanitized result in the change ticket, without credentials or user data. Confirm bootstrap prerequisites and transaction readiness separately before scheduling bootstrap or application traffic.

If initialization reports an error, the resulting definition differs from the approved specification, the operation affects an unexpected index, or the outcome is ambiguous, stop. Do not retry blindly, drop an index, edit records, or invoke bootstrap. Preserve sanitized diagnostics and ask the database owner to determine the next approved action.

## Current verification limits

This runbook and source review cannot verify live User/Workspace records, live index definitions, deployment topology, transaction support, or production readiness. Those remain unverified until an authorized operator performs the read-only checks against the confirmed target. Any earlier HTTP 500 root cause also remains unconfirmed absent direct logs.
