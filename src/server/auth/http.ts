import { NextResponse, type NextRequest } from 'next/server';
import { ApiErrorSchema, validationErrorResponse } from '@/lib/schemas';
import type { z } from 'zod';

export function requestId() { return crypto.randomUUID(); }

function parseHttpOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash
      || parsed.origin !== value) return null;
    return parsed.origin;
  } catch { return null; }
}

function configuredSiteOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch { return null; }
}

/**
 * Trust the configured public site origin when present. Next may reconstruct
 * request.url with an internal host behind a proxy, so it is not an additional
 * allowed origin. Without configuration, use the request URL for local setups.
 */
export function sameOrigin(request: NextRequest, configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const requestOrigin = parseHttpOrigin(origin);
  if (!requestOrigin) return false;
  if (configuredSiteUrl !== undefined) {
    const trustedOrigin = configuredSiteOrigin(configuredSiteUrl);
    return trustedOrigin !== null && requestOrigin === trustedOrigin;
  }
  try { return requestOrigin === new URL(request.url).origin; } catch { return false; }
}

export function authError(status: number, code: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'UNAVAILABLE', message: string) {
  const body = { error: { code, message }, requestId: requestId() };
  return NextResponse.json(ApiErrorSchema.parse(body), { status, headers: { 'Cache-Control': 'no-store' } });
}

export function authValidationError(error: z.ZodError) {
  return NextResponse.json(validationErrorResponse(error, requestId()), { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

export function authSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ data, requestId: requestId() }, { status, headers: { 'Cache-Control': 'no-store' } });
}
