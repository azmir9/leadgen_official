# Registration 429 and IP diagnostics

## Trusted client IP

Production IP extraction accepts `x-vercel-forwarded-for`, then `x-real-ip`, only when the Vercel runtime marker `VERCEL=1` is present. Both values are parsed as IP addresses; for a comma-separated value, only its first address is considered. The implementation never trusts generic `x-forwarded-for` or `unknown` as a shared rate-limit key. Vercel documents these platform headers as the requester's public IP and says its edge overwrites them. A reverse proxy in front of Vercel can change that contract; verify the actual deployment path before relying on it.

If the runtime is production but Vercel is not identified, or neither trusted header contains a valid IP, login, registration, and password-reset endpoints fail closed with HTTP 503 and a request ID. The log contains the fixed reason `trusted_client_ip_unavailable`; no raw IP is logged. For another production host, add a provider-specific trusted-proxy adapter after confirming which proxy overwrites its header. Do not use an arbitrary client-supplied forwarding header.

For local development and tests, the two Vercel-named headers are accepted without the runtime marker so local route tests can supply deterministic IPs. Production behavior remains gated by `VERCEL=1`.

## Correlating an application 429

After deploying the instrumented version, open browser Developer Tools → Network, submit registration, select `POST /api/auth/register`, then inspect its JSON Response for `requestId`. A rate-limit response is HTTP 429 and includes `Retry-After`; its corresponding function log has the same `requestId`, `stage: "register_rate_limit_ip"`, and `reason: "registration_ip_limit_exceeded"`. Search the Vercel project's Functions/Runtime Logs for that request ID. A storage/connect failure instead appears as an error at `register_rate_limit_ip_connect` or `register_rate_limit_ip_bucket` and returns HTTP 500; a slow storage operation logs `reason: "rate_limit_storage_slow"`. The missing-IP response is HTTP 503 with `reason: "trusted_client_ip_unavailable"`.

Do not search logs using an IP address. The rate-limit key stored in MongoDB is a SHA-256 digest of the scope and identity.

## Read-only production database checks

No production database query is run by this project workflow. An operator with a read-only database account can check the `RateLimitBucket` collection indexes and confirm the unique `{ key: 1, bucket: 1 }` index and TTL index on `expiresAt` with `expireAfterSeconds: 0`. Use the actual collection name reported by MongoDB rather than assuming model pluralization.

For the configured owner, normalize the configured `SUPER_ADMIN_USERNAME` to trimmed lowercase, then perform read-only `findOne` queries on the `users` and `workspaces` collections. Verify the user has `role: "super-admin"`, `status: "active"`, and a `workspaceId`; verify the referenced workspace has `adminId` equal to that user's `_id` and `isActive: true`. Do not include environment-variable values, credentials, or connection strings in logs or tickets.
