import { NextRequest, NextResponse } from 'next/server';
import { createCartServiceClient } from '@/server/cart/service-client';
import { processStripeWebhook } from '@/server/checkout/stripe-webhook';
import { getStripeWebhookClient } from '@/server/checkout/stripe-webhook-client';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Webhook signature is required.' } }, { status: 400 });

  let rawBody: Buffer;
  try { rawBody = Buffer.from(await request.arrayBuffer()); }
  catch { return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Webhook body could not be read.' } }, { status: 400 }); }

  try {
    const { stripe, webhookSecret } = getStripeWebhookClient();
    const serviceClient = createCartServiceClient();
    const result = await processStripeWebhook({ rawBody, signature, webhookSecret, stripe, serviceClient });
    if (result === 'invalid_signature') {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Webhook signature is invalid.' } }, { status: 400 });
    }
    return NextResponse.json({ received: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // No payload or secret is logged; a 5xx lets Stripe retry API/database failures.
    return NextResponse.json({ error: { code: 'UNAVAILABLE', message: 'Webhook processing is temporarily unavailable.' } }, { status: 503 });
  }
}
