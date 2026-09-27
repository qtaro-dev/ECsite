import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  createCartServiceClient: vi.fn(),
  claimExpiredCheckoutAttempts: vi.fn(),
  applyReconciliationFacts: vi.fn(),
  getReconciliationStripeClient: vi.fn(),
  readStripeReconciliationFacts: vi.fn(),
  unavailableReconciliationFacts: vi.fn(),
}));

vi.mock('@/server/cart/service-client', () => ({ createCartServiceClient: deps.createCartServiceClient }));
vi.mock('@/server/checkout/reconciliation-store', () => ({
  claimExpiredCheckoutAttempts: deps.claimExpiredCheckoutAttempts,
  applyReconciliationFacts: deps.applyReconciliationFacts,
}));
vi.mock('@/server/checkout/stripe-reconciliation', () => ({
  getReconciliationStripeClient: deps.getReconciliationStripeClient,
  readStripeReconciliationFacts: deps.readStripeReconciliationFacts,
  unavailableReconciliationFacts: deps.unavailableReconciliationFacts,
}));

import { POST } from '@/app/api/internal/reconcile-payments/route';

const secret = 't32-route-test-internal-job-secret-with-at-least-32-bytes';
const candidate = { orderId: '00000000-0000-4000-8000-000000000001', attemptId: '00000000-0000-4000-8000-000000000002', sessionId: 'cs_test_t32_route' };
const facts = { orderId: candidate.orderId, attemptId: candidate.attemptId, result: 'succeeded', sessionId: candidate.sessionId };

function signedRequest(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(timestamp, 'ascii').update('\n', 'ascii').update(Buffer.from(body)).digest('hex');
  return new NextRequest('https://shop.example/api/internal/reconcile-payments', {
    method: 'POST', body,
    headers: {
      'content-type': 'application/json',
      'x-internal-job-timestamp': timestamp,
      'x-internal-job-signature': signature,
    },
  });
}

describe('POST /api/internal/reconcile-payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_JOB_SECRET = secret;
    deps.createCartServiceClient.mockReturnValue({});
    deps.claimExpiredCheckoutAttempts.mockResolvedValue([candidate]);
    deps.getReconciliationStripeClient.mockReturnValue({});
    deps.readStripeReconciliationFacts.mockResolvedValue(facts);
    deps.applyReconciliationFacts.mockResolvedValue({ status: 'processed' });
    deps.unavailableReconciliationFacts.mockReturnValue({ ...facts, result: 'unavailable' });
  });

  it('verifies the exact raw body before calling Stripe or the database', async () => {
    const request = signedRequest('{"limit": 1}');
    request.headers.set('x-internal-job-signature', '0'.repeat(64));
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(deps.createCartServiceClient).not.toHaveBeenCalled();
  });

  it('rejects signed invalid JSON shapes and oversized requests', async () => {
    const invalid = await POST(signedRequest('{"limit": 0}'));
    expect(invalid.status).toBe(400);
    expect((await POST(signedRequest('{"limit": 4}'))).status).toBe(400);
    expect(deps.createCartServiceClient).not.toHaveBeenCalled();
    const oversized = await POST(signedRequest(`{"padding":"${'x'.repeat(4096)}"}`));
    expect(oversized.status).toBe(400);
  });

  it('uses a small bounded default batch and reports checked state counts', async () => {
    const response = await POST(signedRequest('{}'));
    expect(response.status).toBe(200);
    expect(deps.claimExpiredCheckoutAttempts).toHaveBeenCalledWith({ serviceClient: {}, limit: 3 });
    expect(deps.readStripeReconciliationFacts).toHaveBeenCalledWith({
      stripe: {}, orderId: candidate.orderId, attemptId: candidate.attemptId, sessionId: candidate.sessionId,
    });
    expect(await response.json()).toEqual({
      received: true, checked: 1, processed: 1, needsReview: 0, alreadyResolved: 0, unavailable: 0,
    });
  });

  it('retains an unavailable Stripe candidate for review and returns 503 on database failure', async () => {
    deps.readStripeReconciliationFacts.mockRejectedValueOnce(new Error('Stripe unavailable'));
    deps.applyReconciliationFacts.mockResolvedValueOnce({ status: 'needs_review' });
    const response = await POST(signedRequest('{}'));
    expect(response.status).toBe(200);
    expect(deps.applyReconciliationFacts).toHaveBeenCalledWith({ serviceClient: {}, facts: { ...facts, result: 'unavailable' } });
    expect(await response.json()).toMatchObject({ needsReview: 1, unavailable: 1 });

    deps.applyReconciliationFacts.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await POST(signedRequest('{}'))).status).toBe(503);
    deps.claimExpiredCheckoutAttempts.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await POST(signedRequest('{}'))).status).toBe(503);
  });
});
