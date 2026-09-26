import { describe, expect, it } from 'vitest';
import { calculateCheckoutQuote, type CheckoutCatalogProduct } from '@/server/checkout/quote-calculation';
import type { Address, CartProjection } from '@/lib/schemas';
import type { ShippingSettings } from '@/server/shipping/calculator';

const address: Address = {
  recipientName: 'テスト受取人', postalCode: '1000001', prefectureCode: 13,
  city: '千代田区', street: '千代田1-1', building: null, isDefault: true,
};
const settings: ShippingSettings = {
  version: 'shipping-v2', originPrefectureCode: 13, baseFeeYen: 940, freeThresholdYen: 10000,
  heavyThresholdG: 20000, yamatoSourceUrl: 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',
  sourceCheckedAt: '2026-09-25T00:00:00.000Z', isActive: true, heavyRuleJson: { rates: [
    { originPrefectureCode: 13, destinationPrefectureCode: 13, sizeCode: 60, feeYen: 1500 },
    { originPrefectureCode: 13, destinationPrefectureCode: 13, sizeCode: 140, feeYen: 2500 },
  ] },
};
const product: CheckoutCatalogProduct = {
  id: '00000000-0000-4000-8000-000000000001', sku: 'TEST-1', name: 'テスト商品', brand: '例示',
  category: 'cpu', priceTaxIncludedYen: 9999, taxRateBasisPoints: 1000, weightG: 1000,
  packLengthMm: 100, packWidthMm: 100, packHeightMm: 100, specs: { socket_code: 'AM5' }, status: 'published', deletedAt: null,
};
const cart: CartProjection = {
  items: [{ productId: product.id, quantity: 1, unitPriceYen: 9999, lineTotalYen: 9999, availableQuantity: 5,
    unitPriceAtAddYen: 9000, name: product.name, slug: 'test-product', brand: product.brand, sku: product.sku,
    imagePath: null, availabilityState: 'available' }],
  goodsTotalYen: 9999, estimatedShippingYen: 940,
};

function calculate(overrides: { cart?: CartProjection; products?: CheckoutCatalogProduct[]; stock?: number; settings?: ShippingSettings } = {}) {
  const products = overrides.products ?? [product];
  const sourceCart = overrides.cart ?? cart;
  return calculateCheckoutQuote({
    cart: sourceCart,
    products,
    availableByProductId: new Map(products.map(({ id }) => [id, overrides.stock ?? 5])),
    address,
    settings: overrides.settings ?? settings,
  });
}

describe('checkout formal quote calculation', () => {
  it('uses live product amounts and shared tax/shipping rules for the 9,999 yen boundary', () => {
    const result = calculate();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote).toMatchObject({ goodsTotalYen: 9999, shipping: { baseYen: 940, heavyYen: 0, totalYen: 940 }, grandTotalYen: 10939, taxTotalYen: 994 });
    expect(result.quote.priceChanges).toEqual([{ productId: product.id, name: product.name, unitPriceAtAddYen: 9000, unitPriceYen: 9999 }]);
  });

  it('applies free ordinary shipping at 10,000 yen while preserving heavy parcel fees', () => {
    const tenThousand: CheckoutCatalogProduct = { ...product, priceTaxIncludedYen: 10000 };
    const normal = calculate({ products: [tenThousand], cart: { ...cart, items: [{ ...cart.items[0], unitPriceYen: 10000, lineTotalYen: 10000 }], goodsTotalYen: 10000, estimatedShippingYen: 0 } });
    expect(normal.ok && normal.quote.shipping.baseYen).toBe(0);

    const heavy: CheckoutCatalogProduct = { ...product, priceTaxIncludedYen: 10000, weightG: 20000, packLengthMm: 300, packWidthMm: 200, packHeightMm: 100 };
    const heavyCart: CartProjection = { ...cart, items: [{ ...cart.items[0], unitPriceYen: 10000, lineTotalYen: 10000 }], goodsTotalYen: 10000 };
    const result = calculate({ products: [heavy], cart: heavyCart });
    expect(result.ok && result.quote.shipping).toEqual({ baseYen: 0, heavyYen: 2500, totalYen: 2500 });
  });

  it('recalculates live price and blocks stock changes or unavailable published items', () => {
    const price = calculate({ products: [{ ...product, priceTaxIncludedYen: 10001 }] });
    expect(price.ok).toBe(true);
    if (price.ok) {
      expect(price.quote.items[0]).toMatchObject({ unitPriceYen: 10001, lineTotalYen: 10001 });
      expect(price.quote.goodsTotalYen).toBe(10001);
      expect(price.quote.priceChanges).toEqual([{ productId: product.id, name: product.name, unitPriceAtAddYen: 9000, unitPriceYen: 10001 }]);
    }
    expect(calculate({ stock: 0 })).toMatchObject({ ok: false, failure: { kind: 'stock_unavailable' } });
    expect(calculate({ products: [{ ...product, status: 'hidden' }] })).toMatchObject({ ok: false, failure: { kind: 'product_unavailable' } });
    expect(calculate({ cart: { ...cart, items: [], goodsTotalYen: 0 } })).toMatchObject({ ok: false, failure: { kind: 'cart_empty' } });
  });

  it('blocks a missing heavy rate or unknown package data instead of estimating a final amount', () => {
    const heavy: CheckoutCatalogProduct = { ...product, weightG: 20000, packLengthMm: 300, packWidthMm: 200, packHeightMm: 100 };
    expect(calculate({ products: [heavy], settings: { ...settings, heavyRuleJson: { rates: [] } } }))
      .toMatchObject({ ok: false, failure: { kind: 'shipping_unavailable', reason: 'rate_table_unavailable' } });
    expect(calculate({ products: [{ ...heavy, weightG: null }] }))
      .toMatchObject({ ok: false, failure: { kind: 'shipping_unavailable', reason: 'product_weight_unavailable' } });
  });

  it('keeps compatibility mismatches as review warnings instead of blocking the quote', () => {
    const motherboard: CheckoutCatalogProduct = {
      ...product, id: '00000000-0000-4000-8000-000000000002', sku: 'TEST-2', category: 'motherboard',
      priceTaxIncludedYen: 5000, specs: { socket_code: 'AM4', ddr_generation: 'DDR4', form_factor: 'ATX' },
    };
    const combinedCart: CartProjection = {
      items: [
        { ...cart.items[0], unitPriceYen: 9999, lineTotalYen: 9999 },
        { ...cart.items[0], productId: motherboard.id, unitPriceYen: 5000, lineTotalYen: 5000 },
      ],
      goodsTotalYen: 14999, estimatedShippingYen: 940,
    };
    const result = calculate({ products: [product, motherboard], cart: combinedCart, stock: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.compatibility.find((finding) => finding.rule === 'cpu_motherboard_socket')?.status).toBe('incompatible');
    expect(result.quote.grandTotalYen).toBeGreaterThan(0);
  });
});
