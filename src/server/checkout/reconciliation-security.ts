import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_CLOCK_SKEW_SECONDS = 300;

export type ReconciliationAuthHeaders = { timestamp: string | null; signature: string | null };

/** Verifies HMAC-SHA256(timestamp + LF + exact raw request bytes). */
export function verifyReconciliationRequest(input: {
  secret: string | undefined;
  headers: ReconciliationAuthHeaders;
  rawBody: Buffer;
  nowEpochSeconds?: number;
}): boolean {
  const { secret, headers, rawBody } = input;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32 || !headers.timestamp || !headers.signature) return false;
  if (!/^\d{1,12}$/.test(headers.timestamp) || !/^[0-9a-f]{64}$/.test(headers.signature)) return false;
  const timestamp = Number(headers.timestamp);
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;

  const expected = createHmac('sha256', secret)
    .update(headers.timestamp, 'ascii')
    .update('\n', 'ascii')
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(headers.signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}
