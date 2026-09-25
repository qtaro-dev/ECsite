"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Skeleton } from "@/components/Skeleton";
import { StatusMessage } from "@/components/StatusMessage";
import type { ProductCategory } from "@/lib/schemas";
import type { ProductSearchItem, ProductSearchResult } from "@/server/catalog/product-search";
import styles from "./CatalogExplorer.module.css";

const categories: Array<{ slug: ProductCategory; name: string }> = [
  { slug: "cpu", name: "CPU" }, { slug: "gpu", name: "グラフィックボード" },
  { slug: "motherboard", name: "マザーボード" }, { slug: "memory", name: "メモリ" },
  { slug: "ssd", name: "SSD" }, { slug: "power-supply", name: "電源ユニット" },
  { slug: "pc-case", name: "PCケース" }, { slug: "cpu-cooler", name: "CPUクーラー" },
];
const categoryNames = Object.fromEntries(categories.map((item) => [item.slug, item.name])) as Record<ProductCategory, string>;
const usageOptions = [{ id: "gaming", name: "ゲーム" }, { id: "daily", name: "普段使い" }, { id: "editing", name: "動画編集" }] as const;
type SpecField = { key: string; label: string; type: "text" | "number" | "list" };
const specFields: Partial<Record<ProductCategory, SpecField[]>> = {
  cpu: [{ key: "socket_code", label: "ソケット", type: "text" }, { key: "core_count", label: "コア数", type: "number" }, { key: "base_clock_mhz", label: "基本クロック（MHz）", type: "number" }, { key: "tdp_w", label: "TDP（W）", type: "number" }],
  gpu: [{ key: "chipset", label: "チップセット", type: "text" }, { key: "vram_gb", label: "VRAM（GB）", type: "number" }, { key: "card_length_mm", label: "カード長（mm）", type: "number" }],
  motherboard: [{ key: "socket_code", label: "ソケット", type: "text" }, { key: "ddr_generation", label: "メモリ規格", type: "text" }, { key: "form_factor", label: "フォームファクター", type: "text" }],
  memory: [{ key: "ddr_generation", label: "メモリ規格", type: "text" }, { key: "capacity_gb", label: "容量（GB）", type: "number" }, { key: "module_count", label: "枚数", type: "number" }, { key: "speed_mt_s", label: "速度（MT/s）", type: "number" }],
  ssd: [{ key: "capacity_gb", label: "容量（GB）", type: "number" }, { key: "interface", label: "接続規格", type: "text" }, { key: "form_factor", label: "フォームファクター", type: "text" }],
  "power-supply": [{ key: "rated_w", label: "定格出力（W）", type: "number" }, { key: "form_factor", label: "フォームファクター", type: "text" }, { key: "efficiency_grade", label: "変換効率", type: "text" }],
  "pc-case": [{ key: "max_gpu_length_mm", label: "対応GPU長（mm）", type: "number" }, { key: "outer_length_mm", label: "奥行（mm）", type: "number" }, { key: "outer_width_mm", label: "幅（mm）", type: "number" }, { key: "outer_height_mm", label: "高さ（mm）", type: "number" }, { key: "supported_form_factors", label: "対応フォームファクター（カンマ区切り）", type: "list" }],
  "cpu-cooler": [{ key: "supported_socket_codes", label: "対応ソケット（カンマ区切り）", type: "list" }, { key: "height_mm", label: "高さ（mm）", type: "number" }, { key: "cooling_type", label: "冷却方式", type: "text" }],
};

type ExplorerProps = { category?: ProductCategory };

function displayPrice(price: number) {
  return new Intl.NumberFormat("ja-JP").format(price);
}

function productSubtitle(product: ProductSearchItem) {
  if (product.beginnerNote) return product.beginnerNote;
  return product.description || "仕様や価格を確認して比較できます。";
}

function specDisplayValue(value: string | number | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function ProductCard({ product }: { product: ProductSearchItem }) {
  return <article className={styles.productCard}>
    <Link className={styles.productLink} href={`/products/${product.slug}`} aria-label={`${product.name}の商品詳細`}>
      <div className={styles.productVisual} aria-hidden="true"><span>{categoryNames[product.category as ProductCategory] ?? "PC PARTS"}</span><strong>{product.name.slice(0, 1)}</strong></div>
      <div className={styles.productBody}><p className={styles.brand}>{product.brand} <span>／</span> {product.sku}</p>
        <h3>{product.name}</h3><p className={styles.productNote}>{productSubtitle(product)}</p>
        <p className={styles.price}>¥{displayPrice(product.priceYen)}<small>（税込）</small></p>
      </div>
    </Link>
    <Link className={styles.detailButton} href={`/products/${product.slug}`}>商品詳細を見る <span aria-hidden="true">→</span></Link>
  </article>;
}

export function CatalogExplorer({ category }: ExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [searchState, setSearchState] = useState<{
    key: string;
    result: ProductSearchResult | null;
    error: "unavailable" | "invalid" | null;
    fieldErrors: string[];
  } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const params = useMemo(() => new URLSearchParams(queryString), [queryString]);
  const requestParams = useMemo(() => {
    const next = new URLSearchParams(queryString);
    if (category) next.set("category", category);
    return next.toString();
  }, [category, queryString]);
  const requestKey = `${requestParams}:${retryKey}`;
  const loading = searchState?.key !== requestKey;
  const result = loading ? null : searchState?.result ?? null;
  const error = loading ? null : searchState?.error ?? null;
  const fieldErrors = loading ? [] : searchState?.fieldErrors ?? [];

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/products${requestParams ? `?${requestParams}` : ""}`, { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          if (response.status === 400 && typeof payload === "object" && payload !== null && "error" in payload) {
            const apiError = (payload as { error?: { fieldErrors?: Record<string, string[]> } }).error;
            setSearchState({ key: requestKey, result: null, error: "invalid", fieldErrors: Object.keys(apiError?.fieldErrors ?? {}) });
          } else setSearchState({ key: requestKey, result: null, error: "unavailable", fieldErrors: [] });
          return;
        }
        const data = (payload as { data?: ProductSearchResult }).data;
        if (!data || !Array.isArray(data.items)) throw new Error("Invalid search response");
        setSearchState({ key: requestKey, result: data, error: null, fieldErrors: [] });
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setSearchState({ key: requestKey, result: null, error: "unavailable", fieldErrors: [] });
      });
    return () => controller.abort();
  }, [requestParams, requestKey]);

  const currentCategory = category ?? (categories.some((item) => item.slug === params.get("category")) ? params.get("category") as ProductCategory : undefined);
  const fields = currentCategory ? specFields[currentCategory] ?? [] : [];
  const selectedSpec = (() => { try { return JSON.parse(params.get("spec") ?? "{}") as Record<string, string | number | string[]>; } catch { return {}; } })();

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    const q = String(form.get("q") ?? "").trim();
    const usage = String(form.get("usage") ?? "");
    const selected = String(form.get("category") ?? "");
    const manufacturer = String(form.get("manufacturer") ?? "").trim();
    const minPrice = String(form.get("minPrice") ?? "").trim();
    const maxPrice = String(form.get("maxPrice") ?? "").trim();
    const minGpuClearanceMm = String(form.get("minGpuClearanceMm") ?? "").trim();
    const sort = String(form.get("sort") ?? "newest");
    if (q) next.set("q", q);
    if (usage) next.set("usage", usage);
    if (selected) next.set("category", selected);
    if (manufacturer) next.set("manufacturer", manufacturer);
    if (minPrice) next.set("minPrice", minPrice);
    if (maxPrice) next.set("maxPrice", maxPrice);
    if (minGpuClearanceMm) next.set("minGpuClearanceMm", minGpuClearanceMm);
    if (sort !== "newest") next.set("sort", sort);
    const spec: Record<string, string | number | string[]> = {};
    for (const field of fields) {
      const value = String(form.get(`spec.${field.key}`) ?? "").trim();
      if (!value) continue;
      spec[field.key] = field.type === "number" ? Number(value) : field.type === "list" ? value.split(",").map((part) => part.trim()).filter(Boolean) : value;
    }
    if (Object.keys(spec).length) next.set("spec", JSON.stringify(spec));
    router.push(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
    setFilterOpen(false);
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(queryString);
    if (page <= 1) next.delete("page"); else next.set("page", String(page));
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const title = category ? `${categoryNames[category]}の商品` : "商品を探す";
  return <main className={styles.main} id="main-content" tabIndex={-1}>
    <nav className={styles.breadcrumb} aria-label="パンくずリスト"><Link href="/">トップ</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
    <header className={styles.pageHeader}><p className={styles.eyebrow}>{category ? "COMPONENTS" : "SEARCH PRODUCTS"}</p><h1>{title}</h1>
      <p>{category ? `${categoryNames[category]}の仕様や価格で絞り込めます。` : "条件を組み合わせて、公開中の商品を探せます。"}</p></header>
    <form className={styles.topSearch} action="/search" role="search"><label htmlFor="catalog-q">キーワード</label><input id="catalog-q" name="q" type="search" maxLength={100} defaultValue={params.get("q") ?? ""} placeholder="商品名・型番・キーワード" /><button type="submit">検索</button></form>
    <div className={styles.explorer}>
      <button className={styles.filterToggle} type="button" aria-expanded={filterOpen} aria-controls="catalog-filters" onClick={() => setFilterOpen(!filterOpen)}>{filterOpen ? "絞り込みを閉じる" : "絞り込み条件を表示"}</button>
      <div id="catalog-filters" className={`${styles.filters} ${filterOpen ? styles.filtersOpen : ""}`}>
        <form key={queryString} onSubmit={applyFilters}>
          <h2>条件を指定</h2>
          <label>カテゴリ<select name="category" defaultValue={category ?? params.get("category") ?? ""}><option value="">すべて</option>{categories.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label>
          <label>用途<select name="usage" defaultValue={params.get("usage") ?? ""}><option value="">指定なし</option>{usageOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>メーカー<input name="manufacturer" type="search" maxLength={100} defaultValue={params.get("manufacturer") ?? ""} /></label>
          <fieldset><legend>価格（税込）</legend><div className={styles.priceFields}><label>下限<input name="minPrice" inputMode="numeric" pattern="[0-9]*" defaultValue={params.get("minPrice") ?? ""} /></label><span>〜</span><label>上限<input name="maxPrice" inputMode="numeric" pattern="[0-9]*" defaultValue={params.get("maxPrice") ?? ""} /></label></div></fieldset>
          {currentCategory === "pc-case" && <label>対応GPU長以上（mm）<input name="minGpuClearanceMm" type="number" min={1} defaultValue={params.get("minGpuClearanceMm") ?? ""} /></label>}
          {fields.length > 0 && <fieldset className={styles.specs}><legend>仕様</legend>{fields.map((field) => <label key={field.key}>{field.label}<input name={`spec.${field.key}`} type={field.type === "number" ? "number" : "text"} min={field.type === "number" ? 1 : undefined} defaultValue={specDisplayValue(selectedSpec[field.key])} /></label>)}</fieldset>}
          <label>並べ替え<select name="sort" defaultValue={params.get("sort") ?? "newest"}><option value="newest">新着順</option><option value="price_asc">価格が安い順</option><option value="price_desc">価格が高い順</option></select></label>
          <button className={styles.apply} type="submit">条件を適用</button>
        </form>
      </div>
      <section className={styles.results} aria-labelledby="results-title" aria-live="polite">
        <div className={styles.resultsHeading}><h2 id="results-title">検索結果</h2>{result && !loading && <p>{result.total.toLocaleString("ja-JP")}件</p>}</div>
        {loading && <div className={styles.skeletonGrid} aria-busy="true"><Skeleton lines={4} label="商品を読み込み中" /><Skeleton lines={4} label="商品を読み込み中" /><Skeleton lines={4} label="商品を読み込み中" /></div>}
        {error === "invalid" && <StatusMessage kind="error" title="検索条件を確認してください"><p>入力した条件を利用できません。項目の形式や価格の範囲を見直してください。</p>{fieldErrors.length > 0 && <p>確認が必要な項目：{fieldErrors.join("、")}</p>}<Link href={pathname}>このカテゴリの商品を表示</Link></StatusMessage>}
        {error === "unavailable" && <StatusMessage kind="error" title="商品を読み込めませんでした"><p>検索サービスに接続できませんでした。時間をおいて再度お試しください。</p><button className={styles.retry} type="button" onClick={() => setRetryKey((value) => value + 1)}>もう一度試す</button></StatusMessage>}
        {!loading && !error && result && result.total === 0 && <div className={styles.empty}><p className={styles.emptyMark} aria-hidden="true">0</p><h3>条件に合う商品が見つかりませんでした</h3><p>価格や仕様の条件を広げるか、条件を解除してお試しください。</p><Link href={pathname} className={styles.clear}>条件を解除する</Link><p><Link href="/search">すべての商品を見る</Link></p></div>}
        {!loading && !error && result && result.total > 0 && <>
          <div className={styles.productGrid}>{result.items.map((item) => <ProductCard key={item.id} product={item} />)}</div>
          {result.total > result.pageSize && <nav className={styles.pagination} aria-label="検索結果ページ"><button type="button" disabled={result.page <= 1} onClick={() => goToPage(result.page - 1)}>前のページ</button><span>{result.page} / {Math.ceil(result.total / result.pageSize)}ページ</span><button type="button" disabled={result.page >= Math.ceil(result.total / result.pageSize)} onClick={() => goToPage(result.page + 1)}>次のページ</button></nav>}
        </>}
      </section>
    </div>
  </main>;
}
