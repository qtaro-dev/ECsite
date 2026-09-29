import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusMessage } from "@/components/StatusMessage";
import { parseProductSearch, searchProducts } from "@/server/catalog/product-search";
import { getPublishedProductDetail, type ProductDetail } from "@/server/catalog/product-detail";
import styles from "./page.module.css";

const useCases = {
  gaming: { title: "ゲーミングPC", intro: "ゲーム向けにショップが構成した完成PCです。採用パーツと在庫を比べてお選びください。" },
  daily: { title: "一般用途向けPC", intro: "仕事や学習、日々の作業向けにショップが構成した完成PCです。" },
  editing: { title: "クリエイターPC", intro: "動画編集などの制作作業向けにショップが構成した完成PCです。" },
} as const;
type Usage = keyof typeof useCases;

const partLabels = [
  ["cpu", "CPU"], ["gpu", "GPU（グラフィックボード）"], ["memory", "メモリ"], ["ssd", "SSD"],
  ["motherboard", "マザーボード"], ["powerSupply", "電源ユニット"], ["pcCase", "PCケース"],
] as const;

type Part = { key: string; label: string; details: string };
function componentSummary(product: ProductDetail): Part[] {
  const specifications = product.specifications as Record<string, unknown> | null;
  const components = specifications?.components;
  if (typeof components !== "object" || components === null || Array.isArray(components)) return [];
  const values = components as Record<string, unknown>;
  return partLabels.flatMap(([key, label]) => {
    const value = values[key];
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    return typeof item.label === "string" && typeof item.details === "string"
      ? [{ key, label, details: `${item.label} — ${item.details}` }]
      : [];
  });
}

function isUsage(value: string): value is Usage {
  return Object.hasOwn(useCases, value);
}

async function loadProducts(usage: Usage): Promise<ProductDetail[]> {
  const result = await searchProducts(parseProductSearch({ category: "prebuilt-pc", usage }));
  const details = await Promise.all(result.items.map((item) => getPublishedProductDetail(item.slug)));
  if (details.some((product) => product === null)) throw new Error("Product list changed while loading details");
  return details.filter((product): product is ProductDetail =>
    product !== null && product.category === "prebuilt-pc" && product.useCases.includes(usage),
  );
}

export default async function PrebuiltPCUseCasePage({ params }: { params: Promise<{ usage: string }> }) {
  const { usage } = await params;
  if (!isUsage(usage)) notFound();
  const page = useCases[usage];

  let products: ProductDetail[] = [];
  let unavailable = false;
  try {
    products = await loadProducts(usage);
  } catch {
    unavailable = true;
  }

  return <main className={styles.main} id="main-content" tabIndex={-1}>
    <nav className={styles.breadcrumb} aria-label="パンくずリスト">
      <Link href="/">トップ</Link><span aria-hidden="true">/</span><Link href="/#use-title">用途別から探す</Link>
      <span aria-hidden="true">/</span><span aria-current="page">{page.title}</span>
    </nav>
    <header className={styles.header}>
      <p className={styles.eyebrow}>SHOP-ASSEMBLED PC</p>
      <h1>{page.title}</h1>
      <p>{page.intro}</p>
    </header>

    {unavailable ? <StatusMessage kind="error" title="完成PCを読み込めませんでした">
      <p>商品情報を取得できませんでした。時間をおいて再度お試しください。</p>
      <Link href={`/prebuilt-pc/${usage}`}>この一覧を再読み込み</Link>
    </StatusMessage> : products.length === 0 ? <StatusMessage kind="info" title="この用途の完成PCは現在ありません">
      <p>商品を準備中です。別の用途をお選びください。</p>
      <Link href="/#use-title">用途を選び直す</Link>
    </StatusMessage> : <section className={styles.productGrid} aria-label={`${page.title}の商品一覧`}>
      {products.map((product) => {
        const components = componentSummary(product);
        return <article className={styles.productCard} key={product.id}>
          <div className={styles.productBody}>
            <p className={styles.sku}>完成PC ／ {product.sku}</p>
            <h2><Link href={`/products/${product.slug}`}>{product.name}</Link></h2>
            <p className={styles.price}>¥{product.priceYen.toLocaleString("ja-JP")} <small>（税込）</small></p>
            <p className={product.availableQuantity > 0 ? styles.available : styles.soldOut} role="status">
              {product.availableQuantity > 0 ? `販売可能：${product.availableQuantity.toLocaleString("ja-JP")}点` : "在庫切れ"}
            </p>
            <h3>主な構成</h3>
            <dl className={styles.componentList}>
              {components.slice(0, 4).map((component) => <div key={component.key}>
                <dt>{component.label}</dt><dd>{component.details}</dd>
              </div>)}
            </dl>
          </div>
          <Link className={styles.detailLink} href={`/products/${product.slug}`}>構成と購入方法を見る</Link>
        </article>;
      })}
    </section>}
    <p className={styles.returnLink}><Link href="/#use-title">用途を選び直す</Link></p>
  </main>;
}
