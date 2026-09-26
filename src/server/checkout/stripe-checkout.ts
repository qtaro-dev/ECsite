import 'server-only';

export type StripeCheckoutSessionInput = {
  orderId: string;
  attemptId: string;
  amountYen: number;
  allocationExpiresAt: string;
  siteOrigin: string;
};

export type StripeCheckoutSession = { id: string; url: string; createdAtEpochSeconds: number; expiresAtEpochSeconds: number };

export type StripeCheckoutSessionParams = {
  mode: 'payment';
  currency: 'jpy';
  locale: 'ja';
  submit_type: 'pay';
  line_items: Array<{
    price_data: { currency: 'jpy'; unit_amount: number; product_data: { name: string } };
    quantity: 1;
  }>;
  metadata: { order_id: string; attempt_id: string };
  payment_intent_data: { metadata: { order_id: string; attempt_id: string } };
  expires_at: number;
  success_url: string;
  cancel_url: string;
};

export type StripeCheckoutSdk = {
  checkout: {
    sessions: {
      create(params: StripeCheckoutSessionParams, options: { idempotencyKey: string }): Promise<unknown>;
      expire(sessionId: string): Promise<unknown>;
    };
  };
};

export type StripeCheckoutErrorKind = 'configuration' | 'definitive_failure' | 'uncertain';

export class StripeCheckoutError extends Error {
  constructor(readonly kind: StripeCheckoutErrorKind, readonly code: 'CONFIGURATION' | 'ALLOCATION_WINDOW_ELAPSED' | 'STRIPE_FAILURE' | 'RESPONSE_UNCERTAIN' = 'STRIPE_FAILURE') { super(code); }
}

export function requireStripeTestSecretKey(secretKey: string | undefined): string {
  if (!secretKey || !/^sk_test_[A-Za-z0-9_]+$/.test(secretKey)) {
    throw new StripeCheckoutError('configuration');
  }
  return secretKey;
}

/** Stripe requires expiry at least 30 minutes from Session creation. Keep the
 * requested absolute deadline within the T29 order-creation + 35 minute hold. */
export function sessionExpiryEpochSeconds(allocationExpiresAt: string, nowMilliseconds = Date.now()): number {
  const allocationDeadlineMs = Date.parse(allocationExpiresAt);
  if (!Number.isFinite(allocationDeadlineMs) || !Number.isFinite(nowMilliseconds)) {
    throw new StripeCheckoutError('configuration', 'CONFIGURATION');
  }
  // Round the request time up so Stripe's second precision does not see an
  // expiry shorter than 30 minutes after Session creation.
  // A 10-second network/processing margin avoids a sub-30-minute request at
  // Stripe after second rounding. The returned Session is checked against the
  // actual Stripe-created timestamp and the order allocation deadline.
  const stripeExpiry = Math.ceil(nowMilliseconds / 1000) + 1800 + 10;
  const allocationDeadline = Math.floor(allocationDeadlineMs / 1000);
  if (stripeExpiry > allocationDeadline || stripeExpiry * 1000 <= nowMilliseconds) {
    throw new StripeCheckoutError('definitive_failure', 'ALLOCATION_WINDOW_ELAPSED');
  }
  return stripeExpiry;
}

/** Builds the one-line, tax-inclusive JPY amount from the server-created order only. */
export function buildStripeCheckoutSessionParams(input: StripeCheckoutSessionInput, nowMilliseconds = Date.now()): StripeCheckoutSessionParams {
  if (!Number.isSafeInteger(input.amountYen) || input.amountYen < 0) {
    throw new StripeCheckoutError('configuration', 'CONFIGURATION');
  }
  // Stripe charges have a 50 JPY minimum. This is a defensive adapter guard;
  // route UX for a lower valid catalog total remains a separate contract.
  if (input.amountYen < 50) throw new StripeCheckoutError('definitive_failure', 'STRIPE_FAILURE');
  let origin: URL;
  try { origin = new URL(input.siteOrigin); } catch { throw new StripeCheckoutError('configuration', 'CONFIGURATION'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new StripeCheckoutError('configuration', 'CONFIGURATION');
  }
  const expiresAtEpochSeconds = sessionExpiryEpochSeconds(input.allocationExpiresAt, nowMilliseconds);
  const metadata = { order_id: input.orderId, attempt_id: input.attemptId };
  return {
    mode: 'payment',
    currency: 'jpy',
    locale: 'ja',
    submit_type: 'pay',
    line_items: [{
      price_data: {
        currency: 'jpy',
        unit_amount: input.amountYen,
        product_data: { name: `ご注文 ${input.orderId}` },
      },
      quantity: 1,
    }],
    metadata,
    payment_intent_data: { metadata },
    expires_at: expiresAtEpochSeconds,
    success_url: `${origin.origin}/checkout/status?orderId=${encodeURIComponent(input.orderId)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin.origin}/checkout/review?orderId=${encodeURIComponent(input.orderId)}&payment=cancelled`,
  };
}

function statusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : null;
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^cs_test_[A-Za-z0-9_]+$/.test(value);
}

async function expireCreatedSession(sdk: StripeCheckoutSdk, sessionId: string): Promise<void> {
  try {
    const expired = await sdk.checkout.sessions.expire(sessionId);
    if (typeof expired !== 'object' || expired === null || (expired as Record<string, unknown>).status !== 'expired') {
      throw new StripeCheckoutError('uncertain', 'RESPONSE_UNCERTAIN');
    }
  } catch {
    throw new StripeCheckoutError('uncertain', 'RESPONSE_UNCERTAIN');
  }
}

/**
 * SDK adapter. A network/5xx outcome is ambiguous, so callers must retain the
 * allocation and retry with the same Stripe idempotency key. Only a received
 * 4xx is a definitive failure eligible for atomic release compensation.
 */
export function createStripeCheckoutGateway(sdk: StripeCheckoutSdk) {
  return {
    async createSession(input: StripeCheckoutSessionInput, idempotencyKey: string): Promise<StripeCheckoutSession> {
      const params = buildStripeCheckoutSessionParams(input);
      let response: unknown;
      try {
        response = await sdk.checkout.sessions.create(params, { idempotencyKey });
      } catch (error) {
        const status = statusCode(error);
        const definitiveClientError = status !== null && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
        throw new StripeCheckoutError(definitiveClientError ? 'definitive_failure' : 'uncertain');
      }
      if (typeof response !== 'object' || response === null) throw new StripeCheckoutError('uncertain');
      const session = response as Record<string, unknown>;
      if (session.livemode !== false || !validSessionId(session.id)
        || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
        throw new StripeCheckoutError('uncertain', 'RESPONSE_UNCERTAIN');
      }
      if (!Number.isSafeInteger(session.created) || !Number.isSafeInteger(session.expires_at)
        || session.expires_at !== params.expires_at) throw new StripeCheckoutError('uncertain', 'RESPONSE_UNCERTAIN');
      const created = session.created as number;
      const expires = session.expires_at as number;
      const allocationDeadline = Math.floor(Date.parse(input.allocationExpiresAt) / 1000);
      if (expires - created < 1800 || allocationDeadline - created <= 1800 || expires > allocationDeadline) {
        await expireCreatedSession(sdk, session.id);
        throw new StripeCheckoutError('definitive_failure', 'ALLOCATION_WINDOW_ELAPSED');
      }
      return { id: session.id, url: session.url, createdAtEpochSeconds: created, expiresAtEpochSeconds: expires };
    },
  };
}
