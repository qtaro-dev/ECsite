import 'server-only';
import type { Address, CartProjection, ProductCategory } from '@/lib/schemas';
import { createCartServiceClient } from '@/server/cart/service-client';
import type { CheckoutCatalogProduct } from './quote-calculation';
import type { ShippingSettings } from '@/server/shipping/calculator';

export class CheckoutQuoteSourceError extends Error {
  constructor(readonly code: 'ADDRESS_NOT_FOUND' | 'UNAVAILABLE') { super(code); }
}

export type CheckoutQuoteSource = {
  address: Address & { id: string };
  products: CheckoutCatalogProduct[];
  availableByProductId: Map<string, number>;
  settings: ShippingSettings;
};

const PRODUCT_SELECT = [
  'id,sku,name,brand,status,deleted_at,price_tax_included_yen,tax_rate_basis_points,weight_g,pack_length_mm,pack_width_mm,pack_height_mm',
  'category:categories(slug)',
  'cpu_specs(socket_code)', 'gpu_specs(card_length_mm)',
  'motherboard_specs(socket_code,ddr_generation,form_factor)', 'memory_specs(ddr_generation)',
  'ssd_specs(capacity_gb)', 'psu_specs(rated_w)',
  'case_specs(max_gpu_length_mm,supported_form_factors)', 'cooler_specs(supported_socket_codes)',
].join(',');
const CATEGORY_SPEC_TABLE: Record<ProductCategory, string> = {
  cpu: 'cpu_specs', gpu: 'gpu_specs', motherboard: 'motherboard_specs', memory: 'memory_specs',
  ssd: 'ssd_specs', 'power-supply': 'psu_specs', 'pc-case': 'case_specs', 'cpu-cooler': 'cooler_specs',
};

function relationRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

export function mapCheckoutCatalogProduct(row: Record<string, unknown>): CheckoutCatalogProduct | null {
  const categoryRow = relationRow(row.category);
  const category = categoryRow?.slug;
  if (typeof category !== 'string' || !Object.hasOwn(CATEGORY_SPEC_TABLE, category)) return null;
  const specs = relationRow(row[CATEGORY_SPEC_TABLE[category as ProductCategory]]) ?? {};
  const nullableNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  if (typeof row.id !== 'string' || typeof row.sku !== 'string' || typeof row.name !== 'string'
    || typeof row.brand !== 'string' || typeof row.status !== 'string'
    || typeof row.price_tax_included_yen !== 'number' || typeof row.tax_rate_basis_points !== 'number') return null;
  return {
    id: row.id, sku: row.sku, name: row.name, brand: row.brand, category: category as ProductCategory,
    priceTaxIncludedYen: row.price_tax_included_yen, taxRateBasisPoints: row.tax_rate_basis_points,
    weightG: nullableNumber(row.weight_g), packLengthMm: nullableNumber(row.pack_length_mm),
    packWidthMm: nullableNumber(row.pack_width_mm), packHeightMm: nullableNumber(row.pack_height_mm),
    specs, status: row.status, deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null,
  };
}

export async function loadCheckoutQuoteSource(
  userId: string,
  addressId: string,
  cart: CartProjection,
): Promise<CheckoutQuoteSource> {
  const client = createCartServiceClient();
  const { data: addressRow, error: addressError } = await client.from('addresses')
    .select('id,recipient_name,postal_code,prefecture_code,city,street,building,is_default')
    .eq('id', addressId).eq('user_id', userId).maybeSingle();
  if (addressError) throw new CheckoutQuoteSourceError('UNAVAILABLE');
  if (!addressRow) throw new CheckoutQuoteSourceError('ADDRESS_NOT_FOUND');
  const address = {
    id: addressRow.id, recipientName: addressRow.recipient_name, postalCode: addressRow.postal_code,
    prefectureCode: addressRow.prefecture_code, city: addressRow.city, street: addressRow.street,
    building: addressRow.building, isDefault: addressRow.is_default,
  };
  if (!cart.items.length) return { address, products: [], availableByProductId: new Map(), settings: {} as ShippingSettings };

  const productIds = cart.items.map(({ productId }) => productId);
  const [productsResult, inventoryResult, settingsResult] = await Promise.all([
    client.from('products').select(PRODUCT_SELECT).in('id', productIds),
    client.from('inventory').select('product_id,on_hand,allocated').in('product_id', productIds),
    client.from('shipping_settings').select('version,origin_prefecture_code,base_fee_yen,free_threshold_yen,heavy_threshold_g,heavy_rule_json,yamato_source_url,source_checked_at,is_active').eq('is_active', true).maybeSingle(),
  ]);
  if (productsResult.error || inventoryResult.error || settingsResult.error || !settingsResult.data) throw new CheckoutQuoteSourceError('UNAVAILABLE');
  const products = (productsResult.data ?? []).map((row) => mapCheckoutCatalogProduct(row as unknown as Record<string, unknown>)).filter((row): row is CheckoutCatalogProduct => row !== null);
  const availableByProductId = new Map((inventoryResult.data ?? []).map((row) => [row.product_id, Math.max(0, row.on_hand - row.allocated)]));
  const row = settingsResult.data;
  const settings: ShippingSettings = {
    version: row.version, originPrefectureCode: row.origin_prefecture_code,
    baseFeeYen: row.base_fee_yen, freeThresholdYen: row.free_threshold_yen, heavyThresholdG: row.heavy_threshold_g,
    heavyRuleJson: row.heavy_rule_json, yamatoSourceUrl: row.yamato_source_url,
    sourceCheckedAt: row.source_checked_at, isActive: row.is_active,
  };
  return { address, products, availableByProductId, settings };
}
