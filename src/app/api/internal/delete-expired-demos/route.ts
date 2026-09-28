import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createCartServiceClient } from '@/server/cart/service-client';
import { claimDemoDeletion, processDemoDeletion } from '@/server/account/demo-retention';
import { verifyReconciliationRequest } from '@/server/checkout/reconciliation-security';

export const runtime = 'nodejs';
export const maxDuration = 60;
const Body = z.object({ limit: z.number().int().min(1).max(5).optional() }).strict();
const MAX_BODY_BYTES = 4096;

function response(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readLimitedBody(request: NextRequest): Promise<Buffer | null> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared)>MAX_BODY_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total>MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function POST(request: NextRequest) {
  const secret = process.env.T22_INTERNAL_JOB_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8')<32) return response(503, { error: { code: 'UNAVAILABLE' } });
  const rawBody = await readLimitedBody(request);
  if (!rawBody?.length) return response(400, { error: { code: 'BAD_REQUEST' } });
  if (!verifyReconciliationRequest({ secret, rawBody,
    headers: { timestamp: request.headers.get('x-internal-job-timestamp'), signature: request.headers.get('x-internal-job-signature') } })) {
    return response(401, { error: { code: 'UNAUTHORIZED' } });
  }
  let body: unknown;
  try { body = JSON.parse(rawBody.toString('utf8')); } catch { return response(400, { error: { code: 'BAD_REQUEST' } }); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return response(400, { error: { code: 'BAD_REQUEST' } });
  try {
    const client = createCartServiceClient();
    const candidates = await claimDemoDeletion(client, parsed.data.limit ?? 5);
    const outcomes = await Promise.all(candidates.map((userId) => processDemoDeletion({ client, userId })));
    return response(200, { checked: candidates.length,
      deleted: outcomes.filter((status) => status === 'deleted').length,
      deferred: outcomes.filter((status) => status === 'deferred').length });
  } catch { return response(503, { error: { code: 'UNAVAILABLE' } }); }
}
