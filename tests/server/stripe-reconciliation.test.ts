import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
import { classifyReconciliationResult } from '@/server/checkout/stripe-reconciliation';

function session(status: string, paymentStatus: string): Stripe.Checkout.Session {
  return { status, payment_status: paymentStatus } as Stripe.Checkout.Session;
}

function intent(status: string): Stripe.PaymentIntent {
  return { status } as Stripe.PaymentIntent;
}

describe('classifyReconciliationResult', () => {
  it('marks only coherent current Stripe success as succeeded', () => {
    expect(classifyReconciliationResult({ session: session('complete', 'paid'), paymentIntent: intent('succeeded') })).toBe('succeeded');
    expect(classifyReconciliationResult({ session: session('expired', 'paid'), paymentIntent: intent('succeeded') })).toBe('pending');
    expect(classifyReconciliationResult({ session: session('complete', 'unpaid'), paymentIntent: intent('processing') })).toBe('pending');
  });

  it('releases only definitive failed or expired Stripe states', () => {
    expect(classifyReconciliationResult({ session: session('complete', 'unpaid'), paymentIntent: intent('requires_payment_method') })).toBe('failed');
    expect(classifyReconciliationResult({ session: session('complete', 'unpaid'), paymentIntent: intent('canceled') })).toBe('failed');
    expect(classifyReconciliationResult({ session: session('expired', 'unpaid'), paymentIntent: null })).toBe('expired');
    expect(classifyReconciliationResult({ session: session('expired', 'unpaid'), paymentIntent: intent('requires_action') })).toBe('pending');
    expect(classifyReconciliationResult({ session: session('expired', 'paid'), paymentIntent: null })).toBe('pending');
    expect(classifyReconciliationResult({ session: session('open', 'unpaid'), paymentIntent: null })).toBe('pending');
  });
});
