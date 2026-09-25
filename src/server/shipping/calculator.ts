/** Pure shipping and tax calculation for server-side cart and order quotes. */

export const YAMATO_SOURCE_URL = 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html';
export const YAMATO_SIZE_SOURCE_URL = 'https://www.kuronekoyamato.co.jp/ytc/customer/send/search/payment/size/';
export const YAMATO_MAX_LENGTH_MM = 1700;
export const YAMATO_MAX_GIRTH_MM = 2000;
export const YAMATO_MAX_WEIGHT_G = 30000;

export type ShippingQuoteMode = 'estimate' | 'final';
export type YamatoSizeCode = 60 | 80 | 100 | 120 | 140 | 160 | 180 | 200;

export interface ShippingItem {
  unitPriceYen: number;
  quantity: number;
  weightG: number;
  /** Packed dimensions in millimetres, matching the product shipping snapshot. */
  packLengthMm: number | null;
  packWidthMm: number | null;
  packHeightMm: number | null;
}

export interface ShippingAddress {
  prefectureCode: number;
}

export interface HeavyRate {
  originPrefectureCode: number;
  destinationPrefectureCode: number;
  sizeCode: YamatoSizeCode;
  feeYen: number;
}

export interface ShippingSettings {
  version: string;
  originPrefectureCode: number;
  baseFeeYen: number;
  freeThresholdYen: number;
  heavyThresholdG: number;
  yamatoSourceUrl: string;
  sourceCheckedAt: string | null;
  isActive: boolean;
  /** Raw versioned shipping_settings.heavy_rule_json. Shape: { rates: HeavyRate[] }. */
  heavyRuleJson: unknown;
}

export interface ShippingTaxQuote {
  mode: ShippingQuoteMode;
  settingsVersion: string;
  originPrefectureCode: number;
  destinationPrefectureCode: number | null;
  goodsTotalYen: number;
  shippingBaseYen: number;
  /** Null means the cart has heavy items but no destination was selected yet. */
  shippingHeavyYen: number | null;
  shippingTotalYen: number | null;
  taxRateBasisPoints: 1000;
  /** Null means shipping is incomplete and a final tax cannot yet be quoted. */
  taxTotalYen: number | null;
  grandTotalYen: number | null;
  sourceUrl: string;
  sourceCheckedAt: string | null;
}

export type ShippingQuoteErrorReason =
  | 'inactive_settings'
  | 'invalid_settings'
  | 'invalid_items'
  | 'address_required'
  | 'package_unavailable'
  | 'yamato_limit_exceeded'
  | 'rate_table_unavailable'
  | 'rate_unavailable';

export type ShippingQuoteResult =
  | { ok: true; quote: ShippingTaxQuote }
  | { ok: false; code: 'SHIPPING_UNAVAILABLE'; reason: ShippingQuoteErrorReason };

// Yamato's published size and weight bands. The price itself always comes from
// the versioned official-rate rows; this code does not infer or embed rates.
const YAMATO_SIZE_LIMITS: ReadonlyArray<{ size: YamatoSizeCode; girthMm: number; weightG: number }> = [
  { size: 60, girthMm: 600, weightG: 2000 },
  { size: 80, girthMm: 800, weightG: 5000 },
  { size: 100, girthMm: 1000, weightG: 10000 },
  { size: 120, girthMm: 1200, weightG: 15000 },
  { size: 140, girthMm: 1400, weightG: 20000 },
  { size: 160, girthMm: 1600, weightG: 25000 },
  { size: 180, girthMm: 1800, weightG: 30000 },
  { size: 200, girthMm: 2000, weightG: 30000 },
];

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPrefectureCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 47;
}

function isSizeCode(value: unknown): value is YamatoSizeCode {
  return YAMATO_SIZE_LIMITS.some(({ size }) => size === value);
}

function parseRates(value: unknown): HeavyRate[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const rates = (value as Record<string, unknown>).rates;
  if (!Array.isArray(rates) || rates.length === 0) return null;
  const parsed: HeavyRate[] = [];
  for (const rate of rates) {
    if (typeof rate !== 'object' || rate === null || Array.isArray(rate)) return null;
    const row = rate as Record<string, unknown>;
    if (!isPrefectureCode(row.originPrefectureCode)
      || !isPrefectureCode(row.destinationPrefectureCode)
      || !isSizeCode(row.sizeCode)
      || !isSafeNonNegativeInteger(row.feeYen)) return null;
    parsed.push({
      originPrefectureCode: row.originPrefectureCode,
      destinationPrefectureCode: row.destinationPrefectureCode,
      sizeCode: row.sizeCode,
      feeYen: row.feeYen,
    });
  }
  return parsed;
}

function classifyYamatoSize(item: ShippingItem): YamatoSizeCode | 'package_unavailable' | 'yamato_limit_exceeded' {
  const { packLengthMm, packWidthMm, packHeightMm, weightG } = item;
  if (packLengthMm === null || packWidthMm === null || packHeightMm === null
    || ![packLengthMm, packWidthMm, packHeightMm].every((n) => Number.isSafeInteger(n) && n > 0)) {
    return 'package_unavailable';
  }
  if (weightG > YAMATO_MAX_WEIGHT_G
    || Math.max(packLengthMm, packWidthMm, packHeightMm) > YAMATO_MAX_LENGTH_MM) {
    return 'yamato_limit_exceeded';
  }
  const girthMm = packLengthMm + packWidthMm + packHeightMm;
  if (!Number.isSafeInteger(girthMm) || girthMm > YAMATO_MAX_GIRTH_MM) return 'yamato_limit_exceeded';
  const limit = YAMATO_SIZE_LIMITS.find((entry) => girthMm <= entry.girthMm && weightG <= entry.weightG);
  return limit?.size ?? 'yamato_limit_exceeded';
}

function validSettings(settings: ShippingSettings): boolean {
  return typeof settings.version === 'string' && settings.version.trim().length > 0
    && isPrefectureCode(settings.originPrefectureCode)
    && isSafeNonNegativeInteger(settings.baseFeeYen)
    && isSafeNonNegativeInteger(settings.freeThresholdYen)
    && Number.isSafeInteger(settings.heavyThresholdG) && settings.heavyThresholdG > 0
    && typeof settings.yamatoSourceUrl === 'string' && settings.yamatoSourceUrl.startsWith('https://')
    && (settings.sourceCheckedAt === null || typeof settings.sourceCheckedAt === 'string');
}

function safeAdd(total: number, value: number): number | null {
  const next = total + value;
  return Number.isSafeInteger(next) ? next : null;
}

/**
 * Calculates an approximate cart quote or a final address-specific quote.
 * Heavy goods use one packed item per parcel; a missing official rate is a hard failure.
 */
export function calculateShippingAndTax(input: {
  mode: ShippingQuoteMode;
  items: readonly ShippingItem[];
  address?: ShippingAddress;
  settings: ShippingSettings;
}): ShippingQuoteResult {
  const { mode, items, address, settings } = input;
  if (mode !== 'estimate' && mode !== 'final') return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'invalid_settings' };
  if (!settings.isActive) return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'inactive_settings' };
  if (!validSettings(settings)) return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'invalid_settings' };
  if (mode === 'final' && (!address || !isPrefectureCode(address.prefectureCode))) {
    return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'address_required' };
  }
  if (mode === 'estimate' && address && !isPrefectureCode(address.prefectureCode)) {
    return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'address_required' };
  }
  if (items.length === 0 || items.some((item) => !isSafeNonNegativeInteger(item.unitPriceYen)
    || !Number.isSafeInteger(item.quantity) || item.quantity < 1
    || !Number.isSafeInteger(item.weightG) || item.weightG <= 0)) {
    return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'invalid_items' };
  }

  let goodsTotalYen = 0;
  let hasHeavyItems = false;
  const heavyPackages: Array<{ sizeCode: YamatoSizeCode; quantity: number }> = [];
  for (const item of items) {
    const lineTotal = item.unitPriceYen * item.quantity;
    const goodsTotal = safeAdd(goodsTotalYen, lineTotal);
    if (goodsTotal === null) return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'invalid_items' };
    goodsTotalYen = goodsTotal;
    if (item.weightG >= settings.heavyThresholdG) {
      hasHeavyItems = true;
      const size = classifyYamatoSize(item);
      if (size === 'package_unavailable' || size === 'yamato_limit_exceeded') {
        return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: size };
      }
      heavyPackages.push({ sizeCode: size, quantity: item.quantity });
    }
  }

  const shippingBaseYen = goodsTotalYen >= settings.freeThresholdYen ? 0 : settings.baseFeeYen;
  let shippingHeavyYen: number | null = 0;
  if (hasHeavyItems) {
    const rates = parseRates(settings.heavyRuleJson);
    if (rates === null) return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'rate_table_unavailable' };
    if (!address) {
      if (mode === 'final') return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'address_required' };
      // The cart can show a clearly incomplete estimate while destination is unknown.
      shippingHeavyYen = null;
    } else {
      let total = 0;
      for (const parcel of heavyPackages) {
        const row = rates.find((rate) => rate.originPrefectureCode === settings.originPrefectureCode
          && rate.destinationPrefectureCode === address.prefectureCode
          && rate.sizeCode === parcel.sizeCode);
        if (!row) return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'rate_unavailable' };
        for (let count = 0; count < parcel.quantity; count += 1) {
          const next = safeAdd(total, row.feeYen);
          if (next === null) return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'invalid_settings' };
          total = next;
        }
      }
      shippingHeavyYen = total;
    }
  }

  const shippingTotalYen = shippingHeavyYen === null ? null : safeAdd(shippingBaseYen, shippingHeavyYen);
  if (shippingHeavyYen !== null && shippingTotalYen === null) {
    return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'invalid_settings' };
  }
  const grandTotalYen = shippingTotalYen === null ? null : safeAdd(goodsTotalYen, shippingTotalYen);
  if (shippingTotalYen !== null && grandTotalYen === null) {
    return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'invalid_items' };
  }
  // 10% tax inside a tax-included total is total / 11; this avoids overflowing
  // a safe-integer total by multiplying it before division.
  const taxTotalYen = grandTotalYen === null ? null : Math.floor(grandTotalYen / 11);
  if (taxTotalYen !== null && !Number.isSafeInteger(taxTotalYen)) {
    return { ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'invalid_items' };
  }

  return {
    ok: true,
    quote: {
      mode,
      settingsVersion: settings.version,
      originPrefectureCode: settings.originPrefectureCode,
      destinationPrefectureCode: address?.prefectureCode ?? null,
      goodsTotalYen,
      shippingBaseYen,
      shippingHeavyYen,
      shippingTotalYen,
      taxRateBasisPoints: 1000,
      taxTotalYen,
      grandTotalYen,
      sourceUrl: settings.yamatoSourceUrl,
      sourceCheckedAt: settings.sourceCheckedAt,
    },
  };
}
