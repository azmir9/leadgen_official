/**
 * Same-origin guard for cookie-authenticated unsafe HTTP requests.
 * Origin takes precedence; Referer is accepted only when Origin is absent.
 * Requests with neither header, or with malformed/mismatched values, fail closed.
 */
export function isSameOriginRequest(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');

  if (origin !== null) {
    try {
      const parsed = new URL(origin);
      return ['http:', 'https:'].includes(parsed.protocol)
        && parsed.origin === expectedOrigin
        && parsed.origin === origin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('referer');
  if (referer === null) return false;
  try {
    const parsed = new URL(referer);
    return ['http:', 'https:'].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password
      && parsed.origin === expectedOrigin;
  } catch {
    return false;
  }
}
