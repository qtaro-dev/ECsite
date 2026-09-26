'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { StatusMessage } from '@/components/StatusMessage';
import { CompatibilityFindingSchema, type CompatibilityFinding, type ProductCategory } from '@/lib/schemas';
import type { ProductDetail } from '@/server/catalog/product-detail';
import type { ProductSearchItem, ProductSearchResult } from '@/server/catalog/product-search';
import styles from './BuildConfigurator.module.css';

const categories: Array<{ slug: ProductCategory; name: string }> = [
  { slug: 'cpu', name: 'CPU' },
  { slug: 'gpu', name: 'グラフィックボード' },
  { slug: 'motherboard', name: 'マザーボード' },
  { slug: 'memory', name: 'メモリ' },
  { slug: 'ssd', name: 'SSD' },
  { slug: 'power-supply', name: '電源ユニット' },
  { slug: 'pc-case', name: 'PCケース' },
  { slug: 'cpu-cooler', name: 'CPUクーラー' },
];

const rules: Array<{ id: CompatibilityFinding['rule']; title: string }> = [
  { id: 'cpu_motherboard_socket', title: 'CPUとマザーボードのSocket' },
  { id: 'motherboard_memory_ddr', title: 'マザーボードとメモリのDDR規格' },
  { id: 'motherboard_case_form_factor', title: 'マザーボードとケースの形状' },
  { id: 'gpu_case_length', title: 'GPUとケースの搭載可能長' },
  { id: 'cpu_cooler_socket', title: 'CPUとクーラーの対応Socket' },
];

const matchingLinkLabels: Record<CompatibilityFinding['rule'], string> = {
  cpu_motherboard_socket: 'このCPUに対応するマザーボードを見る',
  motherboard_memory_ddr: 'このマザーボードに対応するメモリを見る',
  motherboard_case_form_factor: 'このマザーボードが搭載できるケースを見る',
  gpu_case_length: 'このGPUが収まるケースを見る',
  cpu_cooler_socket: 'このCPUに対応するCPUクーラーを見る',
};

const statusLabels: Record<CompatibilityFinding['status'], string> = {
  compatible: '一致',
  incompatible: '不一致',
  unknown: '判定できません',
  not_applicable: '比較対象が未選択',
};

const comparisonLabels: Record<string, string> = {
  cpuSocketCode: 'CPUのSocket',
  motherboardSocketCode: 'マザーボードのSocket',
  motherboardDdrGeneration: 'マザーボードのDDR規格',
  memoryDdrGeneration: 'メモリのDDR規格',
  motherboardFormFactor: 'マザーボードのフォームファクター',
  caseSupportedFormFactors: 'ケースの対応フォームファクター',
  gpuCardLengthMm: 'GPUのカード長',
  caseMaxGpuLengthMm: 'ケースの最大搭載長',
  coolerSupportedSocketCodes: 'クーラーの対応Socket',
};

const specificationLabels: Record<string, string> = {
  socket_code: 'Socket', core_count: 'コア数', base_clock_mhz: '基本クロック', tdp_w: 'TDP',
  chipset: 'チップセット', vram_gb: 'VRAM', card_length_mm: 'カード長', ddr_generation: 'DDR規格',
  form_factor: 'フォームファクター', capacity_gb: '容量', module_count: '枚数', speed_mt_s: '速度',
  interface: '接続規格', rated_w: '定格出力', efficiency_grade: '変換効率', max_gpu_length_mm: '最大GPU搭載長',
  outer_length_mm: 'ケース奥行', outer_width_mm: 'ケース幅', outer_height_mm: 'ケース高さ',
  supported_form_factors: '対応フォームファクター', supported_socket_codes: '対応Socket', height_mm: '高さ', cooling_type: '冷却方式',
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '未登録';
  if (Array.isArray(value)) return value.join('、');
  return String(value);
};

function readSelectionSlugs(params: URLSearchParams): Partial<Record<ProductCategory, string>> {
  const selected: Partial<Record<ProductCategory, string>> = {};
  for (const { slug } of categories) {
    const value = params.get(slug);
    if (value) selected[slug] = value;
  }
  const legacyCategory = params.get('category') as ProductCategory | null;
  const legacyProduct = params.get('product');
  if (legacyCategory && legacyProduct && categories.some(({ slug }) => slug === legacyCategory) && !selected[legacyCategory]) {
    selected[legacyCategory] = legacyProduct;
  }
  return selected;
}

function ProductSlot({
  category,
  selectedSlug,
  selectedProduct,
  missingSelection,
  onSelect,
  onProductsLoaded,
}: {
  category: { slug: ProductCategory; name: string };
  selectedSlug?: string;
  selectedProduct?: ProductSearchItem;
  missingSelection?: 'missing' | 'unavailable';
  onSelect: (slug: string) => void;
  onProductsLoaded: (category: ProductCategory, products: ProductSearchItem[]) => void;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ProductSearchResult | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [cartBusy, setCartBusy] = useState(false);
  const [cartMessage, setCartMessage] = useState('');

  const requestKey = `${category.slug}:${page}:${searchTerm}:${retryKey}`;
  const loading = loadedKey !== requestKey;
  const error = failedKey === requestKey;
  const currentResult = loadedKey === requestKey ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ category: category.slug, page: String(page) });
    if (searchTerm) params.set('q', searchTerm);
    fetch(`/api/products?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { data?: ProductSearchResult };
        if (!response.ok || !payload.data || !Array.isArray(payload.data.items)) throw new Error('catalog unavailable');
        if (controller.signal.aborted) return;
        setResult(payload.data);
        onProductsLoaded(category.slug, payload.data.items);
        setLoadedKey(requestKey);
        setFailedKey(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError')) return;
        setLoadedKey(requestKey);
        setFailedKey(requestKey);
      })
      ;
    return () => controller.abort();
  }, [category.slug, onProductsLoaded, page, retryKey, searchTerm, requestKey]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchTerm(searchInput.trim());
    setPage(1);
  }

  async function addSelected() {
    if (!displayProduct) return;
    setCartBusy(true);
    setCartMessage('');
    try {
      const response = await fetch('/api/cart', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: displayProduct.id, quantity }),
      });
      if (response.ok) setCartMessage(`${displayProduct.name}をカートに追加しました。`);
      else {
        const payload = await response.json() as { error?: { code?: string } };
        if (payload.error?.code === 'CONFLICT') setCartMessage('販売可能数が更新されています。数量を減らして再度お試しください。');
        else if (payload.error?.code === 'NOT_FOUND') setCartMessage('この商品は現在カートに追加できません。商品一覧から別の商品をお選びください。');
        else setCartMessage('カートに追加できませんでした。時間をおいて再度お試しください。');
      }
    } catch {
      setCartMessage('通信できませんでした。選択した商品は保持されています。時間をおいて再度お試しください。');
    } finally {
      setCartBusy(false);
    }
  }

  const products = currentResult?.items ?? [];
  const displayProduct = selectedProduct ?? products.find((product) => product.slug === selectedSlug);
  const options = displayProduct && !products.some((product) => product.slug === displayProduct.slug)
    ? [displayProduct, ...products]
    : products;

  return <article className={styles.productSlot} aria-labelledby={`slot-${category.slug}`}>
    <div className={styles.slotHeading}><span className={styles.slotNumber} aria-hidden="true">{categories.findIndex(({ slug }) => slug === category.slug) + 1}</span><h2 id={`slot-${category.slug}`}>{category.name}</h2></div>
    <form className={styles.productSearch} onSubmit={applySearch} role="search" aria-label={`${category.name}を検索`}>
      <label htmlFor={`product-search-${category.slug}`}>商品名・型番</label>
      <div className={styles.searchControls}><input id={`product-search-${category.slug}`} type="search" maxLength={100} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={`${category.name}を検索`} /><button type="submit">検索</button></div>
    </form>
    <label className={styles.selectLabel} htmlFor={`product-select-${category.slug}`}>選択する商品</label>
    {loading && <p className={styles.inlineStatus} role="status">商品を読み込み中…</p>}
    {error && <StatusMessage kind="error" title="商品候補を読み込めませんでした"><p>商品検索に接続できませんでした。入力した選択は保持されています。再度お試しください。</p><button type="button" className={styles.retry} onClick={() => setRetryKey((current) => current + 1)}>もう一度試す</button></StatusMessage>}
    {!error && <select id={`product-select-${category.slug}`} value={displayProduct ? selectedSlug : ''} onChange={(event) => { setCartMessage(''); onSelect(event.target.value); }}>
      <option value="">選択しない</option>
      {options.map((product) => <option value={product.slug} key={product.id}>{product.name}（{product.sku}）</option>)}
    </select>}
    {!loading && !error && currentResult?.total === 0 && <p className={styles.inlineStatus}>{searchTerm ? '検索条件に合う商品がありません。' : `${category.name}に公開中の商品はありません。`}</p>}
    {!loading && !error && currentResult && currentResult.total > currentResult.pageSize && <nav className={styles.pagination} aria-label={`${category.name}候補ページ`}>
      <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>前へ</button><span>{page} / {Math.ceil(currentResult.total / currentResult.pageSize)}</span><button type="button" disabled={page >= Math.ceil(currentResult.total / currentResult.pageSize)} onClick={() => setPage((current) => current + 1)}>次へ</button>
    </nav>}
    {missingSelection && !displayProduct && <StatusMessage kind={missingSelection === 'missing' ? 'warning' : 'error'} title={missingSelection === 'missing' ? '選択商品を確認してください' : '選択商品を読み込めませんでした'}>
      <p>{missingSelection === 'missing' ? 'この商品は公開されていないか、見つかりません。別の商品を選択してください。' : '商品サービスに接続できませんでした。時間をおいて再読み込みしてください。'}</p>
    </StatusMessage>}
    {displayProduct && <div className={styles.selectedProduct}>
      <p className={styles.productName}><Link href={`/products/${displayProduct.slug}`}>{displayProduct.name}</Link></p>
      <p>{displayProduct.brand} ／ {displayProduct.sku}</p>
      <p className={styles.price}>¥{displayProduct.priceYen.toLocaleString('ja-JP')} <small>（税込）</small></p>
      {displayProduct.specifications && Object.keys(displayProduct.specifications).length > 0 && <dl className={styles.specifications}>
        {Object.entries(displayProduct.specifications).filter(([, value]) => value !== null && value !== undefined).slice(0, 4).map(([key, value]) => <div key={key}><dt>{specificationLabels[key] ?? key}</dt><dd>{Array.isArray(value) ? value.join('、') : String(value)}{key.endsWith('_mm') ? ' mm' : key.endsWith('_gb') ? ' GB' : key === 'rated_w' || key === 'tdp_w' ? ' W' : ''}</dd></div>)}
      </dl>}
      <div className={styles.cartControls}>
        <label htmlFor={`quantity-${category.slug}`}>数量</label>
        <input id={`quantity-${category.slug}`} type="number" min={1} max={10} value={quantity} onChange={(event) => setQuantity(Math.min(10, Math.max(1, Number(event.target.value) || 1)))} />
        <button type="button" disabled={cartBusy} onClick={() => void addSelected()}>{cartBusy ? '追加中…' : 'カートに追加'}</button>
      </div>
      {cartMessage && <p className={styles.cartMessage} role={cartMessage.includes('追加しました') ? 'status' : 'alert'}>{cartMessage}</p>}
    </div>}
    {selectedSlug && <button className={styles.removeSelection} type="button" onClick={() => { setCartMessage(''); onSelect(''); }}>この部品を外す</button>}
  </article>;
}

export function BuildConfigurator({ initialSelections, initialLoadStates }: {
  initialSelections: ProductDetail[];
  initialLoadStates: BuildSelectionLoadState[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const urlSelections = useMemo(() => readSelectionSlugs(new URLSearchParams(queryString)), [queryString]);
  const initialByCategory = useMemo(() => new Map(initialSelections.map((product) => [product.category as ProductCategory, product])), [initialSelections]);
  const loadStateByCategory = useMemo(() => new Map(initialLoadStates.map(({ category, state }) => [category, state])), [initialLoadStates]);
  const [catalogCache, setCatalogCache] = useState(() => new Map(initialSelections.map((product) => [`${product.category}:${product.slug}`, product as ProductSearchItem])));
  const cacheProducts = useCallback((category: ProductCategory, products: ProductSearchItem[]) => {
    setCatalogCache((current) => {
      const next = new Map(current);
      for (const product of products) next.set(`${category}:${product.slug}`, product);
      return next;
    });
  }, []);
  const selectedProducts = useMemo(() => categories.flatMap(({ slug }) => {
    const selectedSlug = urlSelections[slug];
    const product = (selectedSlug ? catalogCache.get(`${slug}:${selectedSlug}`) : undefined) ?? initialByCategory.get(slug);
    return selectedSlug && product?.slug === selectedSlug ? [{ category: slug, product }] : [];
  }), [catalogCache, initialByCategory, urlSelections]);
  const selectionKey = selectedProducts.map(({ category, product }) => `${category}:${product.id}`).join('|');
  const [compatibility, setCompatibility] = useState<{ key: string; state: 'ready' | 'error'; findings: CompatibilityFinding[]; retry: number }>({ key: '', state: 'ready', findings: [], retry: 0 });
  const [compatibilityRetry, setCompatibilityRetry] = useState(0);

  useEffect(() => {
    if (selectedProducts.length === 0) {
      return;
    }
    const controller = new AbortController();
    fetch('/api/compatibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: selectedProducts.map(({ category, product }) => ({ category, productId: product.id })) }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { data?: unknown };
      if (!response.ok || !Array.isArray(payload.data)) throw new Error('compatibility unavailable');
      const findings = CompatibilityFindingSchema.array().length(5).parse(payload.data);
      setCompatibility({ key: selectionKey, state: 'ready', findings, retry: compatibilityRetry });
    }).catch((cause: unknown) => {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setCompatibility({ key: selectionKey, state: 'error', findings: [], retry: compatibilityRetry });
    });
    return () => controller.abort();
  }, [selectionKey, compatibilityRetry, selectedProducts]);

  const updateSelection = useCallback((category: ProductCategory, slug: string) => {
    const selections = readSelectionSlugs(new URLSearchParams(queryString));
    if (slug) selections[category] = slug; else delete selections[category];
    const next = new URLSearchParams();
    for (const { slug: categorySlug } of categories) {
      const selected = selections[categorySlug];
      if (selected) next.set(categorySlug, selected);
    }
    const search = next.toString();
    router.push(`/build${search ? `?${search}` : ''}`, { scroll: false });
  }, [queryString, router]);

  return <main className={styles.main} id="main-content" tabIndex={-1}>
    <nav className={styles.breadcrumb} aria-label="パンくずリスト"><Link href="/">トップ</Link><span aria-hidden="true">/</span><span aria-current="page">構成確認</span></nav>
    <header className={styles.pageHeader}><p className={styles.eyebrow}>BUILD CHECK</p><h1>パーツの構成を確認</h1>
      <p>商品を選ぶと、設計で定めた5項目の互換性を確認できます。選択内容はURLで共有できます。</p>
      <p className={styles.disclaimer}>ここで確認するのは基本的な互換性です。すべての組合せでPC全体の動作を保証するものではありません。選択は保存されません。</p>
    </header>

    <section aria-labelledby="parts-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>1 — SELECT PARTS</p><h2 id="parts-heading">パーツを選ぶ</h2></div><Link href="/search">商品を探す</Link></div>
      <div className={styles.slotGrid}>{categories.map((category) => {
        const selectedSlug = urlSelections[category.slug];
        const cachedProduct = selectedSlug ? catalogCache.get(`${category.slug}:${selectedSlug}`) : undefined;
        const loadedProduct = initialByCategory.get(category.slug);
        const selectedProduct = cachedProduct?.slug === selectedSlug ? cachedProduct : loadedProduct?.slug === selectedSlug ? loadedProduct : undefined;
        return <ProductSlot key={category.slug} category={category} selectedSlug={selectedSlug} selectedProduct={selectedProduct}
          missingSelection={selectedSlug ? loadStateByCategory.get(category.slug) : undefined}
          onSelect={(slug) => updateSelection(category.slug, slug)} onProductsLoaded={cacheProducts} />;
      })}</div>
    </section>

    <section className={styles.compatibilitySection} aria-labelledby="compatibility-heading">
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>2 — COMPATIBILITY</p><h2 id="compatibility-heading">互換性の確認</h2></div></div>
      {selectedProducts.length === 0 && <StatusMessage kind="info" title="パーツを選択してください"><p>選択した商品に応じて、5項目の比較結果がここに表示されます。未選択の間は構成全体の判定を行いません。</p></StatusMessage>}
      {selectedProducts.length > 0 && (compatibility.key !== selectionKey || compatibility.retry !== compatibilityRetry) && <p role="status" className={styles.inlineStatus}>互換性を判定しています…</p>}
      {selectedProducts.length > 0 && compatibility.key === selectionKey && compatibility.retry === compatibilityRetry && compatibility.state === 'error' && <StatusMessage kind="error" title="互換性を判定できませんでした"><p>判定サービスに接続できませんでした。選択内容は保持されています。時間をおいて再度お試しください。</p><button type="button" className={styles.retry} onClick={() => setCompatibilityRetry((current) => current + 1)}>もう一度試す</button></StatusMessage>}
      {selectedProducts.length > 0 && compatibility.key === selectionKey && compatibility.retry === compatibilityRetry && compatibility.state === 'ready' && compatibility.findings.length === 5 && <div className={styles.findingGrid}>
        {rules.map((rule) => {
          const finding = compatibility.findings.find((item) => item.rule === rule.id);
          if (!finding) return null;
          return <article className={`${styles.finding} ${styles[`finding_${finding.status}`]}`} key={finding.rule}>
            <div className={styles.findingHeading}><h3>{rule.title}</h3><span className={styles.statusBadge}>{statusLabels[finding.status]}</span></div>
            <p>{finding.reason}</p>
            {Object.keys(finding.comparedValues).length > 0 && <dl className={styles.comparisonValues}>{Object.entries(finding.comparedValues).map(([key, value]) => <div key={key}><dt>{comparisonLabels[key] ?? key}</dt><dd>{formatValue(value)}{typeof value === 'number' && ['gpuCardLengthMm', 'caseMaxGpuLengthMm'].includes(key) ? ' mm' : ''}</dd></div>)}</dl>}
            {finding.status === 'unknown' && <p className={styles.missingNote}>必要な仕様が不足しています。互換すると断定できません。</p>}
            {finding.status === 'incompatible' && finding.matchingUrl && <Link className={styles.matchingLink} href={finding.matchingUrl}>{matchingLinkLabels[finding.rule]}</Link>}
          </article>;
        })}
      </div>}
    </section>
  </main>;
}

export type BuildSelectionLoadState = { category: ProductCategory; state: 'missing' | 'unavailable' };
