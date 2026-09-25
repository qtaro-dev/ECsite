const DEFAULT_RETURN_PATH = '/account';
const AUTH_PATHS = new Set(['/login', '/register', '/verify']);

/** Keep post-auth navigation on this site and outside the authentication loop. */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return DEFAULT_RETURN_PATH;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (decoded.startsWith('//') || decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) {
    return DEFAULT_RETURN_PATH;
  }

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const base = new URL(siteUrl);
    const target = new URL(value, base);
    if (target.origin !== base.origin || AUTH_PATHS.has(target.pathname)) return DEFAULT_RETURN_PATH;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
}
