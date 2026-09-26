import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });

import type { SupabaseClient } from '@supabase/supabase-js';
import { CheckoutAllocationRpcResultSchema } from '../../src/lib/checkout-start-schemas';
import type { CheckoutQuoteCalculation, CheckoutCatalogProduct } from '../../src/server/checkout/quote-calculation';
import { allocateCheckoutOrder, buildCheckoutOrderSnapshot } from '../../src/server/checkout/order-allocation';

const address = { id: '00000000-0000-4000-8000-000000000001', recipientName: '受取人', postalCode: '1000001', prefectureCode: 13, city: '千代田区', street: '1-1', building: null, isDefault: false };
const product: CheckoutCatalogProduct = {
  id: '00000000-0000-4000-8000-000000000002', sku: 'CPU-2', name: 'Current CPU', brand: 'Maker', category: 'cpu',
  priceTaxIncludedYen: 10000, taxRateBasisPoints: 1000, weightG: 500, packLengthMm: 300, packWidthMm: 200,
  packHeightMm: 100, specs: { socket_code: 'AM5' }, status: 'published', deletedAt: null,
};
const quote: CheckoutQuoteCalculation = {
  address,
  items: [{ productId: product.id, sku: product.sku, name: product.name, brand: product.brand, category: product.category,
    quantity: 1, unitPriceYen: 10000, lineTotalYen: 10000, availableQuantity: 1, taxRateBasisPoints: 1000,
    unitPriceAtAddYen: 9000 }],
  priceChanges: [{ productId: product.id, name: product.name, unitPriceAtAddYen: 9000, unitPriceYen: 10000 }],
  goodsTotalYen: 10000, shipping: { baseYen: 0, heavyYen: 0, totalYen: 0 }, taxTotalYen: 909,
  grandTotalYen: 10000, shippingSettingsVersion: 'shipping-v2',
  shippingSourceUrl: 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',
  shippingSourceCheckedAt: null,
  compatibility: (['cpu_motherboard_socket', 'motherboard_memory_ddr', 'motherboard_case_form_factor', 'gpu_case_length', 'cpu_cooler_socket'] as const)
    .map((rule) => ({ rule, status: 'compatible' as const, reason: '一致', comparedValues: {}, matchingUrl: null })),
};

describe('checkout order allocation contract', () => {
  it('accepts product-change differences while keeping the next action at response level', () => {
    expect(CheckoutAllocationRpcResultSchema.safeParse({
      status: 'snapshot_stale',
      differences: [{ field: 'product_changed', productId: product.id, name: product.name }],
      nextAction: 'create_new_quote',
    }).success).toBe(true);
  });

  it('uses recalculated current unit price and never turns the cart reference price into an order amount', () => {
    const snapshot = buildCheckoutOrderSnapshot(quote, [product]);
    expect(snapshot.items[0]).toMatchObject({ unitPriceYen: 10000, lineTotalYen: 10000 });
    expect(snapshot.items[0]).not.toHaveProperty('unitPriceAtAddYen');
    expect(snapshot.goodsTotalYen).toBe(10000);
    expect(snapshot.grandTotalYen).toBe(10000);
  });

  it('rejects inconsistent server-calculated tax before reaching the database', () => {
    expect(() => buildCheckoutOrderSnapshot({ ...quote, taxTotalYen: 908 }, [product])).toThrow();
  });

  it('sends only the validated server snapshot to the service-only atomic RPC and returns typed quote differences', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      status: 'quote_changed', changedFields: ['items', 'goods'],
      differences: [{ field: 'price', productId: product.id, name: product.name, quotedYen: 9000, currentYen: 10000 }],
      quotedTotals: { goodsTotalYen: 9000, shippingBaseYen: 940, shippingHeavyYen: 0, taxTotalYen: 903, grandTotalYen: 9940 },
      currentTotals: { goodsTotalYen: 10000, shippingBaseYen: 0, shippingHeavyYen: 0, taxTotalYen: 909, grandTotalYen: 10000 },
      nextAction: 'create_new_quote',
    }, error: null });
    const serviceClient = { rpc } as unknown as SupabaseClient;
    const snapshot = buildCheckoutOrderSnapshot(quote, [product]);
    const result = await allocateCheckoutOrder({ serviceClient, userId: '00000000-0000-4000-8000-000000000003',
      quoteId: '00000000-0000-4000-8000-000000000004', checkoutKey: '00000000-0000-4000-8000-000000000005', snapshot });
    expect(rpc).toHaveBeenCalledWith('create_checkout_order', expect.objectContaining({
      p_user_id: '00000000-0000-4000-8000-000000000003',
      p_quote_id: '00000000-0000-4000-8000-000000000004',
      p_checkout_key: '00000000-0000-4000-8000-000000000005',
    }));
    expect(JSON.stringify(rpc.mock.calls[0][1].p_current_snapshot)).not.toContain('unitPriceAtAddYen');
    expect(result.status).toBe('quote_changed');
    if (result.status === 'quote_changed') {
      expect(result.differences).toContainEqual(expect.objectContaining({ field: 'price', quotedYen: 9000, currentYen: 10000 }));
      expect(result.nextAction).toBe('create_new_quote');
    }
  });

  it('treats malformed RPC output or infrastructure errors as unavailable and never manufactures order IDs', async () => {
    const malformed = { rpc: vi.fn().mockResolvedValue({ data: { status: 'created', orderId: 'not-uuid' }, error: null }) } as unknown as SupabaseClient;
    await expect(allocateCheckoutOrder({ serviceClient: malformed, userId: '00000000-0000-4000-8000-000000000003',
      quoteId: '00000000-0000-4000-8000-000000000004', checkoutKey: '00000000-0000-4000-8000-000000000005', snapshot: buildCheckoutOrderSnapshot(quote, [product]) }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const unavailable = { rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('db unavailable') }) } as unknown as SupabaseClient;
    await expect(allocateCheckoutOrder({ serviceClient: unavailable, userId: '00000000-0000-4000-8000-000000000003',
      quoteId: '00000000-0000-4000-8000-000000000004', checkoutKey: '00000000-0000-4000-8000-000000000005', snapshot: buildCheckoutOrderSnapshot(quote, [product]) }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
