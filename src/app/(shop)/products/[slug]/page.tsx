import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductActions } from "./ProductActions";
import { ProductImage } from "./ProductImage";
import styles from "./page.module.css";
import { getPublishedProductDetail, productImageUrl } from "@/server/catalog/product-detail";

const labels: Record<string, string> = {
  socket_code: "ソケット", core_count: "コア数", base_clock_mhz: "基本クロック（MHz）", tdp_w: "TDP（W）",
  chipset: "チップセット", vram_gb: "VRAM（GB）", card_length_mm: "カード長（mm）",
  ddr_generation: "メモリ規格", form_factor: "フォームファクター", capacity_gb: "容量（GB）",
  module_count: "枚数", speed_mt_s: "速度（MT/s）", interface: "接続規格", rated_w: "定格出力（W）",
  efficiency_grade: "変換効率", max_gpu_length_mm: "対応GPU長（mm）", outer_length_mm: "奥行（mm）",
  outer_width_mm: "幅（mm）", outer_height_mm: "高さ（mm）", supported_form_factors: "対応フォームファクター（カンマ区切り）",
  supported_socket_codes: "対応ソケット（カンマ区切り）", height_mm: "高さ（mm）", cooling_type: "冷却方式",
};
const categoryNames: Record<string, string> = {
  cpu: "CPU", gpu: "グラフィックボード", motherboard: "マザーボード", memory: "メモリ",
  ssd: "SSD", "power-supply": "電源ユニット", "pc-case": "PCケース", "cpu-cooler": "CPUクーラー",
};
const categorySpecFields: Record<string, string[]> = {
  cpu: ["socket_code", "core_count", "base_clock_mhz", "tdp_w"],
  gpu: ["chipset", "vram_gb", "card_length_mm"],
  motherboard: ["socket_code", "ddr_generation", "form_factor"],
  memory: ["ddr_generation", "capacity_gb", "module_count", "speed_mt_s"],
  ssd: ["capacity_gb", "interface", "form_factor"],
  "power-supply": ["rated_w", "form_factor", "efficiency_grade"],
  "pc-case": ["max_gpu_length_mm", "outer_length_mm", "outer_width_mm", "outer_height_mm", "supported_form_factors"],
  "cpu-cooler": ["supported_socket_codes", "height_mm", "cooling_type"],
};
function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "boolean") return value ? "対応" : "非対応";
  return String(value);
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getPublishedProductDetail(slug);
  if (!product) notFound();

  const category = categoryNames[product.category] ?? product.category;
  const specifications = Object.entries(product.specifications ?? {}).filter(([, value]) => value !== null);
  const missingSpecifications = (categorySpecFields[product.category] ?? [])
    .filter((key) => product.specifications?.[key] == null)
    .map((key) => labels[key] ?? key);

  return <main className={styles.main} id="main-content" tabIndex={-1}>
    <nav className={styles.breadcrumb} aria-label="パンくずリスト">
      <Link href="/">トップ</Link><span aria-hidden="true">/</span><Link href={`/categories/${product.category}`}>{category}</Link>
      <span aria-hidden="true">/</span><span aria-current="page">{product.name}</span>
    </nav>
    <div className={styles.layout}>
      <section className={styles.gallery} aria-label="商品画像">
        {product.images.length > 0 ? product.images.map((image, index) => (
          <ProductImage key={`${image.path}-${index}`} src={productImageUrl(image.path)} alt={image.altText} productName={product.name} />
        )) : <div className={styles.imagePlaceholder} role="img" aria-label={`${product.name}の商品画像はありません`}>商品画像はありません</div>}
      </section>
      <section className={styles.summary}>
        <p className={styles.eyebrow}>{category} ／ {product.brand}</p>
        <h1>{product.name}</h1>
        <p className={styles.sku}>型番：{product.sku}</p>
        <p className={styles.price}>¥{product.priceYen.toLocaleString("ja-JP")} <small>（税込）</small></p>
        <p className={styles.description}>{product.description || "商品仕様をご確認のうえ、用途に合わせてお選びください。"}</p>
        <div className={styles.beginner}><h2>初心者向けの選び方</h2><p>{product.beginnerNote || "対応するマザーボードやケースの仕様を確認して選びましょう。"}</p></div>
        <ProductActions productId={product.id} slug={product.slug} availableQuantity={product.availableQuantity} category={product.category} />
      </section>
      <section className={styles.specifications} aria-labelledby="spec-title">
        <h2 id="spec-title">主な仕様</h2>
        {specifications.length > 0 && <dl>{specifications.map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{formatValue(value)}</dd></div>)}</dl>}
        {missingSpecifications.length > 0 && <div className={styles.specificationNotice}>
          <p>次の仕様は登録されていません：{missingSpecifications.join("、")}。</p>
          <p>不足した仕様を使う互換性は「判定できません」と表示されます。仕様がそろった商品をお探しの場合は<Link href={`/categories/${product.category}`}>同じカテゴリの商品一覧</Link>をご覧ください。</p>
        </div>}
      </section>
    </div>
  </main>;
}
