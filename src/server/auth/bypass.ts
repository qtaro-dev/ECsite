/** Authentication verification may only be bypassed in local/test deployments. */
export function authBypassConfigurationError(environment: Record<string, string | undefined>): string | null {
  if (environment.AUTH_BYPASS_ENABLED !== 'true') return null;
  if (environment.NODE_ENV === 'production' || environment.VERCEL_ENV === 'production') {
    return 'AUTH_BYPASS_ENABLED cannot be true in a production environment';
  }
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    return 'AUTH_BYPASS_ENABLED is only supported in development or test';
  }
  return null;
}

const bypassError = authBypassConfigurationError(process.env);
if (bypassError) throw new Error(bypassError);

export const isAuthBypassEnabled = process.env.AUTH_BYPASS_ENABLED === 'true';

export function isEmailConfirmationSatisfied(emailConfirmedAt: string | null | undefined): boolean {
  return Boolean(emailConfirmedAt) || isAuthBypassEnabled;
}
