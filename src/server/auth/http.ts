import { NextResponse, type NextRequest } from 'next/server';
import { ApiErrorSchema, validationErrorResponse } from '@/lib/schemas';
import type { z } from 'zod';

export function requestId() { return crypto.randomUUID(); }

export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
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
