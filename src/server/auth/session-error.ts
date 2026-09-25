/** AuthSessionMissingError means the browser has no stored Supabase session. */
export function isAuthSessionMissing(error: unknown): boolean {
  return error instanceof Error && error.name === 'AuthSessionMissingError';
}
