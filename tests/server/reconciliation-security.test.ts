import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyReconciliationRequest } from '@/server/checkout/reconciliation-security';

const secret = 't32-test-internal-job-secret-at-least-32-bytes';
const rawBody = Buffer.from('{ "limit": 25 }\n');
const now = 1_800_000_000;

function headers(timestamp = String(now), body = rawBody) {
  const signature = createHmac('sha256', secret)
    .update(timestamp, 'ascii').update('\n', 'ascii').update(body).digest('hex');
  return { timestamp, signature };
}

describe('verifyReconciliationRequest', () => {
  it('verifies the exact signed bytes and accepts both 5-minute boundaries', () => {
    expect(verifyReconciliationRequest({ secret, headers: headers(), rawBody, nowEpochSeconds: now })).toBe(true);
    for (const timestamp of [String(now - 300), String(now + 300)]) {
      expect(verifyReconciliationRequest({ secret, headers: headers(timestamp), rawBody, nowEpochSeconds: now })).toBe(true);
    }
  });

  it('rejects changed bytes, stale/future timestamps, malformed headers, and weak configuration', () => {
    const signed = headers();
    expect(verifyReconciliationRequest({ secret, headers: signed, rawBody: Buffer.from(rawBody.toString().trim()), nowEpochSeconds: now })).toBe(false);
    for (const timestamp of [String(now - 301), String(now + 301)]) {
      expect(verifyReconciliationRequest({ secret, headers: headers(timestamp), rawBody, nowEpochSeconds: now })).toBe(false);
    }
    expect(verifyReconciliationRequest({ secret, headers: { ...signed, timestamp: '1e9' }, rawBody, nowEpochSeconds: now })).toBe(false);
    expect(verifyReconciliationRequest({ secret, headers: { ...signed, signature: signed.signature.toUpperCase() }, rawBody, nowEpochSeconds: now })).toBe(false);
    expect(verifyReconciliationRequest({ secret: 'short', headers: signed, rawBody, nowEpochSeconds: now })).toBe(false);
    expect(verifyReconciliationRequest({ secret: undefined, headers: signed, rawBody, nowEpochSeconds: now })).toBe(false);
    expect(verifyReconciliationRequest({ secret, headers: { timestamp: null, signature: null }, rawBody, nowEpochSeconds: now })).toBe(false);
  });
});
