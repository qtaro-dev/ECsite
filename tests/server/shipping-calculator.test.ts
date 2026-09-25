import { describe, expect, it } from 'vitest';
import {
  calculateShippingAndTax,
  type ShippingItem,
  type ShippingSettings,
} from '../../src/server/shipping/calculator';

const settings: ShippingSettings = {
  version: 'rate-v1',
  originPrefectureCode: 13,
  baseFeeYen: 940,
  freeThresholdYen: 10000,
  heavyThresholdG: 20000,
  yamatoSourceUrl: 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',
  sourceCheckedAt: '2026-09-25T00:00:00.000Z',
  isActive: true,
  heavyRuleJson: {
    rates: [
      { originPrefectureCode: 13, destinationPrefectureCode: 1, sizeCode: 140, feeYen: 2200 },
      { originPrefectureCode: 13, destinationPrefectureCode: 47, sizeCode: 140, feeYen: 2500 },
      { originPrefectureCode: 13, destinationPrefectureCode: 13, sizeCode: 140, feeYen: 1800 },
    ],
  },
};

function item(overrides: Partial<ShippingItem> = {}): ShippingItem {
  return {
    unitPriceYen: 9999,
    quantity: 1,
    weightG: 19999,
    packLengthMm: 500,
    packWidthMm: 500,
    packHeightMm: 300,
    ...overrides,
  };
}

describe('calculateShippingAndTax', () => {
  it('charges the base fee at 9,999 yen and waives it at 10,000 yen', () => {
    const below = calculateShippingAndTax({ mode: 'final', items: [item()], address: { prefectureCode: 1 }, settings });
    const threshold = calculateShippingAndTax({
      mode: 'final', items: [item({ unitPriceYen: 10000 })], address: { prefectureCode: 1 }, settings,
    });

    expect(below.ok && below.quote.shippingBaseYen).toBe(940);
    expect(threshold.ok && threshold.quote.shippingBaseYen).toBe(0);
  });

  it('does not add heavy freight below 20,000g and uses an official rate at 20,000g', () => {
    const below = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 19999 })], address: { prefectureCode: 13 }, settings,
    });
    const threshold = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 20000, unitPriceYen: 10000 })], address: { prefectureCode: 13 }, settings,
    });

    expect(below.ok && below.quote.shippingHeavyYen).toBe(0);
    expect(threshold.ok && threshold.quote.shippingHeavyYen).toBe(1800);
    expect(threshold.ok && threshold.quote.shippingTotalYen).toBe(1800);
  });

  it('uses the destination-specific rate for Hokkaido and Okinawa without an island surcharge', () => {
    const hokkaido = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 20000 })], address: { prefectureCode: 1 }, settings,
    });
    const okinawa = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 20000 })], address: { prefectureCode: 47 }, settings,
    });

    expect(hokkaido.ok && hokkaido.quote.shippingHeavyYen).toBe(2200);
    expect(okinawa.ok && okinawa.quote.shippingHeavyYen).toBe(2500);
  });

  it('adds one official parcel rate for every heavy product quantity', () => {
    const result = calculateShippingAndTax({
      mode: 'final',
      items: [item({ unitPriceYen: 4000, weightG: 20000, quantity: 2 })],
      address: { prefectureCode: 13 },
      settings,
    });

    expect(result.ok && result.quote.goodsTotalYen).toBe(8000);
    expect(result.ok && result.quote.shippingBaseYen).toBe(940);
    expect(result.ok && result.quote.shippingHeavyYen).toBe(3600);
    expect(result.ok && result.quote.shippingTotalYen).toBe(4540);
  });

  it('rounds tax down once from the tax-inclusive order total', () => {
    const result = calculateShippingAndTax({
      mode: 'final', items: [item({ unitPriceYen: 1000, weightG: 1000 })], address: { prefectureCode: 13 }, settings,
    });

    expect(result.ok && result.quote.grandTotalYen).toBe(1940);
    expect(result.ok && result.quote.taxTotalYen).toBe(176);
  });

  it('returns incomplete cart shipping when a heavy item has no destination', () => {
    const result = calculateShippingAndTax({
      mode: 'estimate', items: [item({ weightG: 20000 })], settings,
    });

    expect(result.ok && result.quote.mode).toBe('estimate');
    expect(result.ok && result.quote.shippingHeavyYen).toBeNull();
    expect(result.ok && result.quote.shippingTotalYen).toBeNull();
    expect(result.ok && result.quote.taxTotalYen).toBeNull();
  });

  it('returns SHIPPING_UNAVAILABLE for missing package data, rate tables, or unmatched rates', () => {
    const missingPackage = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 20000, packLengthMm: null })], address: { prefectureCode: 13 }, settings,
    });
    const missingTable = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 20000 })], address: { prefectureCode: 13 },
      settings: { ...settings, heavyRuleJson: {} },
    });
    const unmatched = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 20000 })], address: { prefectureCode: 2 }, settings,
    });

    expect(missingPackage).toMatchObject({ ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'package_unavailable' });
    expect(missingTable).toMatchObject({ ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'rate_table_unavailable' });
    expect(unmatched).toMatchObject({ ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'rate_unavailable' });
  });

  it('rejects parcels exceeding Yamato limits and requires an address for a final quote', () => {
    const oversize = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 20000, packLengthMm: 1800 })], address: { prefectureCode: 13 }, settings,
    });
    const overweight = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 30001 })], address: { prefectureCode: 13 }, settings,
    });
    const noAddress = calculateShippingAndTax({ mode: 'final', items: [item()], settings });

    expect(oversize).toMatchObject({ ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'yamato_limit_exceeded' });
    expect(overweight).toMatchObject({ ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'yamato_limit_exceeded' });
    expect(noAddress).toMatchObject({ ok: false, code: 'SHIPPING_UNAVAILABLE', reason: 'address_required' });
  });

  it('preserves the active rule version, source, and origin in the quote', () => {
    const result = calculateShippingAndTax({
      mode: 'final', items: [item({ weightG: 20000 })], address: { prefectureCode: 13 },
      settings: {
        ...settings,
        version: 'rate-v2',
        originPrefectureCode: 27,
        heavyRuleJson: {
          rates: [{ originPrefectureCode: 27, destinationPrefectureCode: 13, sizeCode: 140, feeYen: 1900 }],
        },
      },
    });

    expect(result.ok && result.quote).toMatchObject({
      settingsVersion: 'rate-v2', originPrefectureCode: 27, sourceCheckedAt: settings.sourceCheckedAt,
      shippingHeavyYen: 1900,
    });
  });
});
