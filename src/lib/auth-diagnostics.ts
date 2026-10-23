import { randomUUID } from 'node:crypto';

export type AuthDiagnosticStage =
  | 'db_test_connect'
  | 'rate_limit_database_connect'
  | 'rate_limit_bucket'
  | 'rate_limit_bucket_retry'
  | 'login_request'
  | 'register_request'
  | 'login_rate_limit_ip_connect'
  | 'login_rate_limit_ip_bucket'
  | 'login_rate_limit_ip_retry'
  | 'login_rate_limit_account_connect'
  | 'login_rate_limit_account_bucket'
  | 'login_rate_limit_account_retry'
  | 'login_database_connect'
  | 'login_user_lookup'
  | 'login_pending_worker_interview_lookup'
  | 'login_pending_worker_onboarding_token'
  | 'login_password_verify'
  | 'login_session_create'
  | 'login_session_database_connect'
  | 'login_session_insert'
  | 'register_rate_limit_ip'
  | 'register_rate_limit_ip_connect'
  | 'register_rate_limit_ip_bucket'
  | 'register_rate_limit_ip_retry'
  | 'register_database_connect'
  | 'register_invitation_lookup'
  | 'register_invitation_access_check'
  | 'register_owner_lookup'
  | 'register_default_workspace_lookup'
  | 'register_workspace_lookup'
  | 'register_workspace_provision'
  | 'register_existing_user_lookup'
  | 'register_password_hash'
  | 'register_user_create'
  | 'register_transaction_start'
  | 'register_invitation_audit_write';

export interface AuthDiagnosticContext {
  requestId: string;
  runtimeId: string;
  stage: AuthDiagnosticStage;
  stageStartedAt: number;
  failureLogged: boolean;
  connectionAction?: 'ready_cache' | 'cached_promise' | 'new_connect';
  connectionReadyStateBefore?: number;
  connectionReadyStateAfter?: number;
}

type DiagnosticGlobal = typeof globalThis & { __leadgenDiagnosticRuntimeId?: string };
const diagnosticGlobal = globalThis as DiagnosticGlobal;
const runtimeId = diagnosticGlobal.__leadgenDiagnosticRuntimeId || randomUUID();
diagnosticGlobal.__leadgenDiagnosticRuntimeId = runtimeId;

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL', 'ENODATA', 'ENOTIMP', 'EREFUSED']);
const NETWORK_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export type DiagnosticErrorCategory =
  | 'server_selection_timeout'
  | 'dns_srv_failure'
  | 'tls_network_failure'
  | 'authentication_failure'
  | 'index_key_specs_conflict'
  | 'unknown';

export function createAuthDiagnosticContext(initialStage: AuthDiagnosticStage): AuthDiagnosticContext {
  return {
    requestId: randomUUID(),
    runtimeId,
    stage: initialStage,
    stageStartedAt: Date.now(),
    failureLogged: false,
  };
}

export async function runAuthDiagnosticStage<T>(
  context: AuthDiagnosticContext,
  stage: AuthDiagnosticStage,
  operation: () => Promise<T>,
  shouldLogFailure: (error: unknown) => boolean = () => true,
): Promise<T> {
  context.stage = stage;
  context.stageStartedAt = Date.now();
  try {
    return await operation();
  } catch (error) {
    if (shouldLogFailure(error)) logAuthDiagnosticFailure(context, error);
    throw error;
  }
}

export function logAuthDiagnosticFailure(context: AuthDiagnosticContext, error: unknown) {
  if (context.failureLogged) return;
  context.failureLogged = true;

  try {
    const errorName = readStringProperty(error, 'name');
    const codeName = readStringProperty(error, 'codeName');
    const message = readStringProperty(error, 'message');
    const code = getNumericErrorCode(error);
    console.error({
      requestId: context.requestId,
      runtimeId: context.runtimeId,
      stage: context.stage,
      category: classifyDiagnosticError(error),
      errorName: errorName ? sanitizeDiagnosticText(errorName) : null,
      code: code ?? null,
      codeName: codeName ? sanitizeDiagnosticText(codeName) : null,
      errorMessage: message ? sanitizeDiagnosticText(message) : null,
      elapsedMs: Math.max(0, Date.now() - context.stageStartedAt),
      connectionAction: context.connectionAction ?? null,
      connectionReadyStateBefore: context.connectionReadyStateBefore ?? null,
      connectionReadyStateAfter: context.connectionReadyStateAfter ?? null,
    });
  } catch {
    // Diagnostic failures must never replace the original operation error.
  }
}

export function logAuthDiagnosticCompletion(context: AuthDiagnosticContext) {
  console.info({
    requestId: context.requestId,
    runtimeId: context.runtimeId,
    stage: context.stage,
    elapsedMs: Math.max(0, Date.now() - context.stageStartedAt),
    ...(context.connectionAction ? { connectionAction: context.connectionAction } : {}),
    ...(context.connectionReadyStateBefore === undefined ? {} : { connectionReadyStateBefore: context.connectionReadyStateBefore }),
    ...(context.connectionReadyStateAfter === undefined ? {} : { connectionReadyStateAfter: context.connectionReadyStateAfter }),
  });
}

export function classifyDiagnosticError(error: unknown): DiagnosticErrorCategory {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  let sawServerSelection = false;

  for (let index = 0; index < pending.length && index < 32; index += 1) {
    const current = pending[index];
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    const name = readStringProperty(current, 'name');
    const code = readStringProperty(current, 'code');
    const codeName = readStringProperty(current, 'codeName');
    const numericCode = readNumberProperty(current, 'code');
    if (numericCode === 18 || (name === 'MongoServerError' && numericCode === 8000)) return 'authentication_failure';
    if (numericCode === 86 || codeName === 'IndexKeySpecsConflict') return 'index_key_specs_conflict';
    if (code && DNS_CODES.has(code)) return 'dns_srv_failure';
    if (code && NETWORK_CODES.has(code)) return 'tls_network_failure';
    if (name === 'MongoNetworkError' || name === 'MongoNetworkTimeoutError') return 'tls_network_failure';
    if (name === 'MongoServerSelectionError' || name === 'MongooseServerSelectionError') sawServerSelection = true;

    for (const key of ['cause', 'reason', 'error']) {
      const nested = readProperty(current, key);
      if (nested && typeof nested === 'object') pending.push(nested);
    }
    const errors = readProperty(current, 'errors');
    if (Array.isArray(errors)) pending.push(...errors.slice(0, 8));
    const servers = readProperty(current, 'servers');
    if (servers instanceof Map) {
      for (const server of Array.from(servers.values()).slice(0, 8)) {
        const nestedError = server && typeof server === 'object' ? readProperty(server, 'error') : undefined;
        if (nestedError && typeof nestedError === 'object') pending.push(nestedError);
      }
    }
  }

  return sawServerSelection ? 'server_selection_timeout' : 'unknown';
}

function readProperty(value: unknown, key: string): unknown {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function readStringProperty(value: unknown, key: string): string | undefined {
  const property = readProperty(value, key);
  return typeof property === 'string' ? property : undefined;
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  const property = readProperty(value, key);
  return typeof property === 'number' ? property : undefined;
}

function getNumericErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = readProperty(error, 'code');
  return typeof code === 'number' && Number.isSafeInteger(code) && code >= 0 && code <= 999_999
    ? code
    : undefined;
}

function sanitizeDiagnosticText(value: string) {
  return value
    .slice(0, 4_000)
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, '[MongoDB URI redacted]')
    .replace(/\b(?:private\s+)?(?:mongo(?:db)?\s*)?(?:uri|connection string)(?:\s+and\s+credentials?(?:\s+details?)?)?\b/gi, '[connection details redacted]')
    .replace(/\bcredentials?(?:\s+details?)?\b/gi, '[credentials redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{10,}\.)[A-Za-z0-9_.-]{10,}/g, '[token redacted]')
    .replace(/\b(password|passwd|pwd|token|secret|cookie|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,\s;}]+)/gi, '$1=[redacted]')
    .replace(/\b(username|userId|email|phone|whatsapp|login)\s*(?:[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^,\s;}]+)/gi, '$1=[redacted]')
    .replace(/\b(authentication failed for|authenticating as|user)\s+["']?[^\s,'";]+["']?/gi, '$1 [user redacted]')
    .replace(/\bvalue\s+(?:"[^"]*"|'[^']*')/gi, 'value [redacted]')
    .replace(/dup(?:licate)? key:\s*\{[^}]*\}/gi, 'duplicate key: [values redacted]');
}
