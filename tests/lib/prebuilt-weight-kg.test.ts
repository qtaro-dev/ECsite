import { describe, expect, it } from 'vitest';
import { parsePrebuiltWeightKg, weightGToKgInput } from '@/lib/prebuilt-weight-kg';

describe('prebuilt PC kg editor conversion', () => {
  it.each([
    ['0.001', 1], ['0.5', 500], ['19.999', 19_999], ['20', 20_000], ['30', 30_000],
  ])('converts %s kg to exactly %i g', (kg, grams) => {
    expect(parsePrebuiltWeightKg(kg)).toEqual({ weightG: grams, error: null });
    expect(weightGToKgInput(grams)).toBe(kg);
  });

  it('keeps an empty draft weight empty', () => {
    expect(parsePrebuiltWeightKg('')).toEqual({ weightG: null, error: null });
    expect(weightGToKgInput(null)).toBe('');
  });

  it.each(['0', '-0.5', 'abc', '.5', '1.', '1.0001', '30.001', '31', '1e1', '1,5'])
    ('rejects invalid or out-of-range kg input %s', (input) => {
      const result = parsePrebuiltWeightKg(input);
      expect(result.weightG).toBeNull();
      expect(result.error).toBeTruthy();
    });
});
