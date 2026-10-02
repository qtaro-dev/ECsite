export function weightGToKgInput(weightG: number | null | undefined): string {
  if (weightG == null) return '';
  const whole = Math.floor(weightG / 1000);
  const fraction = String(weightG % 1000).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function parsePrebuiltWeightKg(input: string): { weightG: number | null; error: string | null } {
  const value = input.trim();
  if (!value) return { weightG: null, error: null };
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) return { weightG: null, error: '商品重量はkgで小数第3位まで入力してください。' };
  const whole = Number(match[1]);
  if (whole > 30) return { weightG: null, error: '商品重量は30kg以下で入力してください。' };
  const fraction = Number((match[2] ?? '').padEnd(3, '0'));
  const weightG = whole * 1000 + fraction;
  if (weightG === 0) return { weightG: null, error: '商品重量は0kgより大きい値を入力してください。' };
  if (weightG > 30_000) return { weightG: null, error: '商品重量は30kg以下で入力してください。' };
  return { weightG, error: null };
}
