import { describe, expect, it } from 'vitest';
import { DemoRegionSchema, demoAddress, isDemoAddress } from '../../src/lib/demo-address';

describe('fixed demo address', () => {
  it('accepts only one prefecture code, never name or contact details', () => {
    expect(DemoRegionSchema.safeParse({ prefectureCode: 13 }).success).toBe(true);
    for (const input of [{ prefectureCode: 0 }, { prefectureCode: 48 }, { prefectureCode: 13, name: '実名' }, { prefectureCode: '13' }]) {
      expect(DemoRegionSchema.safeParse(input).success).toBe(false);
    }
  });

  it('recognizes only the fixed fictional fixture', () => {
    const address = demoAddress(1);
    expect(isDemoAddress(address)).toBe(true);
    expect(isDemoAddress({ ...address, recipientName: '実名' })).toBe(false);
    expect(isDemoAddress({ ...address, postalCode: '1000001' })).toBe(false);
    expect(isDemoAddress({ ...address, street: '実住所' })).toBe(false);
  });
});
