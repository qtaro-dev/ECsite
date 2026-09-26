import type { Address, CartProjection, CompatibilityFinding, ProductCategory } from '@/lib/schemas';
import { evaluateCompatibility, type CompatibilityProduct } from '@/server/catalog/compatibility';
import { calculateShippingAndTax, type ShippingSettings } from '@/server/shipping/calculator';

export type CheckoutCatalogProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: ProductCategory;
  priceTaxIncludedYen: number;
  taxRateBasisPoints: number;
  weightG: number | null;
  packLengthMm: number | null;
  packWidthMm: number | null;
  packHeightMm: number | null;
  specs: Record<string, unknown>;
  status: string;
  deletedAt: string | null;
};

export type QuoteCalculationFailure =
  | { kind: 'cart_empty' }
  | { kind: 'product_unavailable'; productIds: string[] }
  | { kind: 'stock_unavailable'; items: Array<{ productId: string; requestedQuantity: number; availableQuantity: number }> }
  | { kind: 'shipping_unavailable'; reason: string };

export type CheckoutQuoteCalculation = {
  address: Address & { id?: string };
  items: Array<{
    productId: string;
    sku: string;
    name: string;
    brand: string;
    category: ProductCategory;
    quantity: number;
    unitPriceYen: number;
    lineTotalYen: number;
    availableQuantity: number;
    taxRateBasisPoints: 1000;
    unitPriceAtAddYen: number | null;
  }>;
  priceChanges: Array<{ productId: string; name: string; unitPriceAtAddYen: number; unitPriceYen: number }>;
  goodsTotalYen: number;
  shipping: { baseYen: number; heavyYen: number; totalYen: number };
  taxTotalYen: number;
  grandTotalYen: number;
  shippingSettingsVersion: string;
  shippingSourceUrl: string;
  shippingSourceCheckedAt: string | null;
  compatibility: CompatibilityFinding[];
};

export function calculateCheckoutQuote(input: {
  cart: CartProjection;
  products: CheckoutCatalogProduct[];
  availableByProductId: ReadonlyMap<string, number>;
  address: Address & { id?: string };
  settings: ShippingSettings;
}): { ok: true; quote: CheckoutQuoteCalculation } | { ok: false; failure: QuoteCalculationFailure } {
  const { cart, products, availableByProductId, address, settings } = input;
  if (!cart.items.length) return { ok: false, failure: { kind: 'cart_empty' } };
  const byId = new Map(products.map((product) => [product.id, product]));
  const cartLines = cart.items;
  const unavailable = cart.items.filter((line) => {
    const product = byId.get(line.productId);
    return !product || product.status !== 'published' || product.deletedAt !== null
      || !Number.isSafeInteger(product.priceTaxIncludedYen) || product.priceTaxIncludedYen < 0
      || product.taxRateBasisPoints !== 1000;
  }).map((line) => line.productId);
  if (unavailable.length) return { ok: false, failure: { kind: 'product_unavailable', productIds: unavailable } };

  const currentProducts = cartLines.map((line) => byId.get(line.productId)!);
  if (currentProducts.some((product) => product.weightG === null || !Number.isSafeInteger(product.weightG) || product.weightG < 1)) {
    return { ok: false, failure: { kind: 'shipping_unavailable', reason: 'product_weight_unavailable' } };
  }
  const shortages = cart.items.flatMap((line) => {
    const availableQuantity = availableByProductId.get(line.productId) ?? 0;
    return availableQuantity < line.quantity ? [{ productId: line.productId, requestedQuantity: line.quantity, availableQuantity }] : [];
  });
  if (shortages.length) return { ok: false, failure: { kind: 'stock_unavailable', items: shortages } };

  const shipping = calculateShippingAndTax({
    mode: 'final',
    address: { prefectureCode: address.prefectureCode },
    settings,
    items: cartLines.map((line, index) => ({
      unitPriceYen: currentProducts[index].priceTaxIncludedYen,
      quantity: line.quantity,
      weightG: currentProducts[index].weightG!,
      packLengthMm: currentProducts[index].packLengthMm,
      packWidthMm: currentProducts[index].packWidthMm,
      packHeightMm: currentProducts[index].packHeightMm,
    })),
  });
  if (!shipping.ok) return { ok: false, failure: { kind: 'shipping_unavailable', reason: shipping.reason } };

  const compatibilityProducts: CompatibilityProduct[] = [];
  const seenCategories = new Set<ProductCategory>();
  currentProducts.forEach((product) => {
    if (seenCategories.has(product.category)) return;
    seenCategories.add(product.category);
    compatibilityProducts.push({ id: product.id, category: product.category, specs: product.specs });
  });
  const findings = evaluateCompatibility(compatibilityProducts);
  return {
    ok: true,
    quote: {
      address,
      items: cartLines.map((line, index) => ({
        productId: line.productId,
        sku: currentProducts[index].sku,
        name: currentProducts[index].name,
        brand: currentProducts[index].brand,
        category: currentProducts[index].category,
        quantity: line.quantity,
        unitPriceYen: currentProducts[index].priceTaxIncludedYen,
        lineTotalYen: currentProducts[index].priceTaxIncludedYen * line.quantity,
        availableQuantity: availableByProductId.get(line.productId) ?? 0,
        taxRateBasisPoints: 1000,
        unitPriceAtAddYen: line.unitPriceAtAddYen,
      })),
      priceChanges: cartLines.flatMap((line, index) => line.unitPriceAtAddYen !== null && line.unitPriceAtAddYen !== currentProducts[index].priceTaxIncludedYen
        ? [{ productId: line.productId, name: currentProducts[index].name, unitPriceAtAddYen: line.unitPriceAtAddYen, unitPriceYen: currentProducts[index].priceTaxIncludedYen }]
        : []),
      goodsTotalYen: shipping.quote.goodsTotalYen,
      shipping: {
        baseYen: shipping.quote.shippingBaseYen,
        heavyYen: shipping.quote.shippingHeavyYen ?? 0,
        totalYen: shipping.quote.shippingTotalYen ?? 0,
      },
      taxTotalYen: shipping.quote.taxTotalYen ?? 0,
      grandTotalYen: shipping.quote.grandTotalYen ?? 0,
      shippingSettingsVersion: shipping.quote.settingsVersion,
      shippingSourceUrl: shipping.quote.sourceUrl,
      shippingSourceCheckedAt: shipping.quote.sourceCheckedAt,
      compatibility: findings,
    },
  };
}
