import { CompatibilityRequestSchema, type CompatibilityFinding, type CompatibilityRequest, type CompatibilityStatus, type ProductCategory } from '../../lib/schemas';

type ProductSpecs = Record<string, unknown>;
export type CompatibilityProduct = { id: string; category: ProductCategory; specs: ProductSpecs };
export type CompatibilityOptions = {
  fetcher?: typeof fetch;
  env?: Pick<NodeJS.ProcessEnv, 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'>;
};

const RULES = [
  { rule: 'cpu_motherboard_socket', left: 'cpu', right: 'motherboard', property: 'socket_code' },
  { rule: 'motherboard_memory_ddr', left: 'motherboard', right: 'memory', property: 'ddr_generation' },
  { rule: 'motherboard_case_form_factor', left: 'motherboard', right: 'pc-case', property: 'form_factor' },
  { rule: 'gpu_case_length', left: 'gpu', right: 'pc-case', property: 'card_length_mm' },
  { rule: 'cpu_cooler_socket', left: 'cpu', right: 'cpu-cooler', property: 'socket_code' },
] as const;

const SPEC_SELECT: Record<ProductCategory, string> = {
  cpu: 'cpu_specs(socket_code)', gpu: 'gpu_specs(card_length_mm)',
  motherboard: 'motherboard_specs(socket_code,ddr_generation,form_factor)',
  memory: 'memory_specs(ddr_generation)', ssd: 'ssd_specs(capacity_gb)',
  'power-supply': 'psu_specs(rated_w)', 'pc-case': 'case_specs(max_gpu_length_mm,supported_form_factors)',
  'cpu-cooler': 'cooler_specs(supported_socket_codes)',
};
const SPEC_ALIAS: Record<ProductCategory, string> = {
  cpu: 'cpu_specs', gpu: 'gpu_specs', motherboard: 'motherboard_specs', memory: 'memory_specs',
  ssd: 'ssd_specs', 'power-supply': 'psu_specs', 'pc-case': 'case_specs', 'cpu-cooler': 'cooler_specs',
};

function readSpec(specs: ProductSpecs, key: string): unknown {
  const value = specs[key];
  if (typeof value === 'string') return value.trim() || null;
  return value ?? null;
}

function finding(rule: typeof RULES[number]['rule'], status: CompatibilityStatus, reason: string, comparedValues: Record<string, unknown>, matchingUrl: string | null): CompatibilityFinding {
  return { rule, status, reason, comparedValues, matchingUrl };
}

function productListUrl(category: ProductCategory, spec?: Record<string, string | number | string[]>, minGpuClearanceMm?: number): string {
  const params = new URLSearchParams({ category });
  if (spec && Object.keys(spec).length) params.set('spec', JSON.stringify(spec));
  if (minGpuClearanceMm !== undefined) params.set('minGpuClearanceMm', String(minGpuClearanceMm));
  return `/search?${params.toString()}`;
}

function comparePair(rule: typeof RULES[number], products: Map<ProductCategory, CompatibilityProduct>): CompatibilityFinding {
  const a = products.get(rule.left);
  const b = products.get(rule.right);
  if (!a || !b) return finding(rule.rule, 'not_applicable', '比較対象の商品が選択されていません。', {}, null);

  if (rule.rule === 'gpu_case_length') {
    const length = readSpec(a.specs, 'card_length_mm');
    const maxLength = readSpec(b.specs, 'max_gpu_length_mm');
    const values = { gpuCardLengthMm: length, caseMaxGpuLengthMm: maxLength };
    if (typeof length !== 'number' || typeof maxLength !== 'number') return finding(rule.rule, 'unknown', 'GPUまたはケースの搭載可能長が不足しているため判定できません。', values, null);
    const ok = length <= maxLength;
    return finding(rule.rule, ok ? 'compatible' : 'incompatible', ok ? `GPU長 ${length}mm はケースの最大搭載長 ${maxLength}mm 以下です。` : `GPU長 ${length}mm はケースの最大搭載長 ${maxLength}mm を超えています。`, values, ok ? null : productListUrl('pc-case', undefined, length));
  }

  const property = rule.property;
  const leftValue = readSpec(a.specs, property);
  let rightValue: unknown;
  let values: Record<string, unknown>;
  let mismatchUrl: string | null = null;
  if (rule.rule === 'motherboard_case_form_factor') {
    rightValue = readSpec(b.specs, 'supported_form_factors');
    values = { motherboardFormFactor: leftValue, caseSupportedFormFactors: rightValue };
    mismatchUrl = typeof leftValue === 'string' ? productListUrl('pc-case', { supported_form_factors: [leftValue] }) : null;
  } else if (rule.rule === 'cpu_cooler_socket') {
    rightValue = readSpec(b.specs, 'supported_socket_codes');
    values = { cpuSocketCode: leftValue, coolerSupportedSocketCodes: rightValue };
    mismatchUrl = typeof leftValue === 'string' ? productListUrl('cpu-cooler', { supported_socket_codes: [leftValue] }) : null;
  } else {
    rightValue = readSpec(b.specs, property);
    values = rule.rule === 'cpu_motherboard_socket' ? { cpuSocketCode: leftValue, motherboardSocketCode: rightValue } : { motherboardDdrGeneration: leftValue, memoryDdrGeneration: rightValue };
    const targetCategory: ProductCategory = rule.rule === 'cpu_motherboard_socket' ? 'motherboard' : 'memory';
    const targetSpecKey = property;
    mismatchUrl = typeof leftValue === 'string' ? productListUrl(targetCategory, { [targetSpecKey]: leftValue }) : null;
  }
  if (leftValue === null || rightValue === null) return finding(rule.rule, 'unknown', '比較に必要な仕様が不足しているため判定できません。', values, null);
  const ok = Array.isArray(rightValue) ? rightValue.includes(leftValue) : leftValue === rightValue;
  const mismatch = rule.rule === 'cpu_motherboard_socket' ? 'CPUとマザーボードのSocketが一致しません。'
    : rule.rule === 'motherboard_memory_ddr' ? 'マザーボードとメモリのDDR規格が一致しません。'
      : rule.rule === 'motherboard_case_form_factor' ? 'ケースがマザーボードのフォームファクターに対応していません。'
        : 'CPUクーラーがCPUのSocketに対応していません。';
  const success = rule.rule === 'cpu_motherboard_socket' ? 'CPUとマザーボードのSocketが一致しています。'
    : rule.rule === 'motherboard_memory_ddr' ? 'マザーボードとメモリのDDR規格が一致しています。'
      : rule.rule === 'motherboard_case_form_factor' ? 'ケースがマザーボードのフォームファクターに対応しています。'
        : 'CPUクーラーがCPUのSocketに対応しています。';
  return finding(rule.rule, ok ? 'compatible' : 'incompatible', ok ? success : mismatch, values, ok ? null : mismatchUrl);
}

export function parseCompatibilityRequest(value: unknown): CompatibilityRequest {
  return CompatibilityRequestSchema.parse(value);
}

export function evaluateCompatibility(products: CompatibilityProduct[]): CompatibilityFinding[] {
  const byCategory = new Map(products.map((product) => [product.category, product]));
  return RULES.map((rule) => comparePair(rule, byCategory));
}

/** Fetches only through the public PostgREST role; RLS omits draft, hidden, and deleted products. */
export async function loadCompatibilityProducts(request: CompatibilityRequest, options: CompatibilityOptions = {}): Promise<CompatibilityProduct[]> {
  const env = options.env ?? process.env;
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase public compatibility configuration is unavailable');
  if (!request.products.length) return [];
  const selects = new Set(request.products.map(({ category }) => SPEC_SELECT[category]));
  const select = ['id', 'category:categories(slug)', ...selects].join(',');
  const ids = request.products.map(({ productId }) => productId);
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/rest/v1/products`);
  url.searchParams.set('select', select);
  url.searchParams.set('id', `in.(${ids.join(',')})`);
  const response = await (options.fetcher ?? fetch)(url, { headers: { apikey: anonKey }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Public compatibility lookup failed with status ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('Public compatibility lookup returned an invalid response');
  return rows.map((value) => {
    const row = value as Record<string, unknown>;
    const categoryValue = row.category as { slug?: unknown } | null;
    const category = categoryValue?.slug;
    if (typeof row.id !== 'string' || typeof category !== 'string' || !Object.hasOwn(SPEC_ALIAS, category)) throw new Error('Public compatibility lookup returned an invalid product');
    const specRow = row[SPEC_ALIAS[category as ProductCategory]];
    const specs = Array.isArray(specRow) ? specRow[0] : specRow;
    return { id: row.id, category: category as ProductCategory, specs: specs && typeof specs === 'object' ? specs as ProductSpecs : {} };
  });
}
