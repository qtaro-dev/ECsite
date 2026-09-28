/** AuthSessionMissingError means the browser has no stored Supabase session. */
export function isAuthSessionMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AuthSessionMissingError') return true;
  // A previously valid JWT can remain in the browser after the account has
  // been deleted. Supabase then returns this definitive auth error from
  // getUser(); treat that stale cookie as anonymous while keeping outages 503.
  return error.name === 'AuthApiError' && 'code' in error && error.code === 'user_not_found';
}
