import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createCartServiceClient } from '@/server/cart/service-client';
import { applyReconciliationFacts, claimExpiredCheckoutAttempts } from '@/server/checkout/reconciliation-store';
import { verifyReconciliationRequest } from '@/server/checkout/reconciliation-security';
import {
  getReconciliationStripeClient,
  readStripeReconciliationFacts,
  unavailableReconciliationFacts,
} from '@/server/checkout/stripe-reconciliation';

export const runtime = 'nodejs';
export const maxDuration = 60;
const DEFAULT_BATCH_SIZE = 3;

const RequestBody = z.object({ limit: z.number().int().min(1).max(3).optional() }).strict();
const MAX_BODY_BYTES = 4096;

async function readLimitedBody(request: NextRequest): Promise<Buffer | null> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch { return null; }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function response(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Called only by Supabase Cron; authenticate exact bytes before parsing JSON. */
export async function POST(request: NextRequest) {
  const jobSecret = process.env.INTERNAL_JOB_SECRET;
  if (!jobSecret || Buffer.byteLength(jobSecret, 'utf8') < 32) {
    return response(503, { error: { code: 'UNAVAILABLE', message: 'Internal job service is not configured.' } });
  }
  const rawBody = await readLimitedBody(request);
  if (!rawBody || rawBody.length === 0) {
    return response(400, { error: { code: 'BAD_REQUEST', message: 'Request body is invalid.' } });
  }

  const verified = verifyReconciliationRequest({
    secret: jobSecret,
    headers: {
      timestamp: request.headers.get('x-internal-job-timestamp'),
      signature: request.headers.get('x-internal-job-signature'),
    },
    rawBody,
  });
  if (!verified) {
    return response(401, { error: { code: 'UNAUTHORIZED', message: 'Internal job signature is invalid.' } });
  }

  let parsedBody: unknown;
  try { parsedBody = JSON.parse(rawBody.toString('utf8')); }
  catch { return response(400, { error: { code: 'BAD_REQUEST', message: 'Request body is invalid.' } }); }
  const parsed = RequestBody.safeParse(parsedBody);
  if (!parsed.success) return response(400, { error: { code: 'BAD_REQUEST', message: 'Request body is invalid.' } });

  try {
    const serviceClient = createCartServiceClient();
    const stripe = getReconciliationStripeClient();
    const candidates = await claimExpiredCheckoutAttempts({ serviceClient, limit: parsed.data.limit ?? DEFAULT_BATCH_SIZE });
    const outcomes = await Promise.all(candidates.map(async (candidate) => {
      let unavailable = false;
      let facts;
      try {
        if (!candidate.sessionId || !/^cs_test_[A-Za-z0-9_]+$/.test(candidate.sessionId)) {
          facts = unavailableReconciliationFacts(candidate);
          unavailable = true;
        } else {
          facts = await readStripeReconciliationFacts({
            stripe, orderId: candidate.orderId, attemptId: candidate.attemptId, sessionId: candidate.sessionId,
          });
          if (facts.sessionId !== candidate.sessionId) throw new Error('SESSION_LOOKUP_MISMATCH');
        }
      } catch {
        facts = unavailableReconciliationFacts(candidate);
        unavailable = true;
      }

      const result = await applyReconciliationFacts({ serviceClient, facts });
      return { status: result.status, unavailable };
    }));
    const counts = {
      processed: outcomes.filter((item) => item.status === 'processed').length,
      needsReview: outcomes.filter((item) => item.status === 'needs_review').length,
      alreadyResolved: outcomes.filter((item) => ['already_resolved', 'already_paid', 'not_due'].includes(item.status)).length,
      unavailable: outcomes.filter((item) => item.unavailable).length,
    };
    return response(200, { received: true, checked: candidates.length, ...counts });
  } catch {
    // A 503 lets Supabase Cron retry. Candidate leases delay overlapping work;
    // allocations stay active whenever the Stripe/DB outcome is uncertain.
    return response(503, { error: { code: 'UNAVAILABLE', message: 'Payment reconciliation is temporarily unavailable.' } });
  }
}
