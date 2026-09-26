import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CheckoutAllocationRpcResultSchema, CheckoutOrderSnapshotSchema, type CheckoutOrderSnapshot } from '@/lib/checkout-start-schemas';
import type { CheckoutQuoteCalculation, CheckoutCatalogProduct } from './quote-calculation';

export class CheckoutAllocationError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'INVALID_SNAPSHOT' | 'INVALID_RESPONSE') { super(code); }
}

/** Builds the server-owned read-set; cart reference prices are deliberately excluded. */
export function buildCheckoutOrderSnapshot(
  quote: CheckoutQuoteCalculation,
  products: readonly CheckoutCatalogProduct[],
): CheckoutOrderSnapshot {
  const byId = new Map(products.map((product) => [product.id, product]));
  const items = quote.items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) throw new CheckoutAllocationError('INVALID_SNAPSHOT');
    return {
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      brand: item.brand,
      category: item.category,
      quantity: item.quantity,
      unitPriceYen: item.unitPriceYen,
      lineTotalYen: item.lineTotalYen,
      weightG: product.weightG,
      packLengthMm: product.packLengthMm,
      packWidthMm: product.packWidthMm,
      packHeightMm: product.packHeightMm,
      specs: product.specs,
    };
  });
  return CheckoutOrderSnapshotSchema.parse({
    address: quote.address,
    items,
    goodsTotalYen: quote.goodsTotalYen,
    shipping: quote.shipping,
    taxTotalYen: quote.taxTotalYen,
    grandTotalYen: quote.grandTotalYen,
    shippingSettingsVersion: quote.shippingSettingsVersion,
    compatibility: quote.compatibility,
  });
}

/** Calls the service-role-only, row-locking RPC after fresh server recalculation. */
export async function allocateCheckoutOrder(input: {
  serviceClient: SupabaseClient;
  userId: string;
  quoteId: string;
  checkoutKey: string;
  snapshot: CheckoutOrderSnapshot;
}) {
  const snapshot = CheckoutOrderSnapshotSchema.safeParse(input.snapshot);
  if (!snapshot.success) throw new CheckoutAllocationError('INVALID_SNAPSHOT');
  let response: { data: unknown; error: unknown };
  try {
    response = await input.serviceClient.rpc('create_checkout_order', {
      p_user_id: input.userId,
      p_quote_id: input.quoteId,
      p_checkout_key: input.checkoutKey,
      p_current_snapshot: snapshot.data,
    });
  } catch {
    throw new CheckoutAllocationError('UNAVAILABLE');
  }
  if (response.error) throw new CheckoutAllocationError('UNAVAILABLE');
  const parsed = CheckoutAllocationRpcResultSchema.safeParse(response.data);
  if (!parsed.success) throw new CheckoutAllocationError('INVALID_RESPONSE');
  return parsed.data;
}
