import { describe, expect, it } from 'vitest';
import { CheckoutQuoteRequestSchema, CheckoutQuoteResultSchema } from '@/lib/checkout-quote-schemas';

const id = '00000000-0000-4000-8000-000000000001';
const address = { id, recipientName: '架空受取人', postalCode: '1000001', prefectureCode: 13, city: '千代田区', street: '千代田1-1', building: null, isDefault: true };
const quote = {
  quoteId: '00000000-0000-4000-8000-000000000010', expiresAt: '2026-09-26T12:30:00.000Z', address,
  items: [{ productId: id, sku: 'SKU-1', name: 'CPU', brand: '例示', category: 'cpu', quantity: 1, unitPriceYen: 9999, lineTotalYen: 9999, availableQuantity: 3, taxRateBasisPoints: 1000, unitPriceAtAddYen: 9999 }],
  priceChanges: [],
  goodsTotalYen: 9999, shipping: { baseYen: 940, heavyYen: 0, totalYen: 940 }, taxTotalYen: 994, grandTotalYen: 10939,
  shippingSettingsVersion: 'shipping-v2', shippingSourceUrl: 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',
  shippingSourceCheckedAt: '2026-09-25T00:00:00.000Z',
  compatibility: ['cpu_motherboard_socket','motherboard_memory_ddr','motherboard_case_form_factor','gpu_case_length','cpu_cooler_socket'].map((rule) => ({ rule, status: 'not_applicable', reason: '比較対象の商品が選択されていません。', comparedValues: {}, matchingUrl: null })),
};

describe('checkout quote contract', () => {
  it('accepts only a saved address identifier for checkout quote requests', () => {
    expect(CheckoutQuoteRequestSchema.safeParse({ addressId: id }).success).toBe(true);
    expect(CheckoutQuoteRequestSchema.safeParse({ addressId: 'not-an-id', grandTotalYen: 0 }).success).toBe(false);
    expect(CheckoutQuoteRequestSchema.safeParse({ addressId: id, grandTotalYen: 1 }).success).toBe(false);
  });
  it('validates response totals and includes the complete order review payload', () => {
    expect(CheckoutQuoteResultSchema.safeParse(quote).success).toBe(true);
    expect(CheckoutQuoteResultSchema.safeParse({ ...quote, grandTotalYen: 100 }).success).toBe(false);
    expect(CheckoutQuoteResultSchema.safeParse({ ...quote, taxTotalYen: 993 }).success).toBe(false);
  });
});
