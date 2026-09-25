import { describe, expect, it } from 'vitest';
import { ShippingSettingsFieldsSchema } from '@/lib/admin-shipping-schemas';

const valid = {
  originPrefectureCode: 13,
  baseFeeYen: 940,
  freeThresholdYen: 10000,
  heavyThresholdG: 20000,
  heavyRuleJson: { rates: [{ originPrefectureCode: 13, destinationPrefectureCode: 1, sizeCode: 160, feeYen: 2500 }] },
  yamatoSourceUrl: 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',
  sourceCheckedAt: '2026-09-25T00:00:00.000Z',
};

describe('shipping settings input', () => {
  it('accepts the approved 20 kg rule and Yamato rate row', () => {
    expect(ShippingSettingsFieldsSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects threshold drift, duplicate rows, non-official URL, and out-of-range fees', () => {
    expect(ShippingSettingsFieldsSchema.safeParse({ ...valid, heavyThresholdG: 19999 }).success).toBe(false);
    expect(ShippingSettingsFieldsSchema.safeParse({ ...valid, heavyRuleJson: { rates: [...valid.heavyRuleJson.rates, ...valid.heavyRuleJson.rates] } }).success).toBe(false);
    expect(ShippingSettingsFieldsSchema.safeParse({ ...valid, yamatoSourceUrl: 'https://kuronekoyamato.co.jp.attacker.test/rates' }).success).toBe(false);
    expect(ShippingSettingsFieldsSchema.safeParse({ ...valid, heavyRuleJson: { rates: [{ ...valid.heavyRuleJson.rates[0], feeYen: 2147483648 }] } }).success).toBe(false);
  });
  it('requires an official source review date when rates exist', () => {
    expect(ShippingSettingsFieldsSchema.safeParse({ ...valid, sourceCheckedAt: null }).success).toBe(false);
  });
});
