import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import styles from './products.module.css';
import { getAdminProducts } from '@/server/admin/products';

export const dynamic = 'force-dynamic';

const labels: Record<string, string> = {
  cpu: 'CPU', gpu: 'GPU', motherboard: 'マザーボード', memory: 'メモリ', ssd: 'SSD',
  'power-supply': '電源', 'pc-case': 'PCケース', 'cpu-cooler': 'CPUクーラー',
};
const statusLabels = { draft: '下書き', published: '公開中', hidden: '非公開' };

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.slice(0, 100) ?? '';
  const auditId = randomUUID();
  let products;
  try { products = await getAdminProducts(q); }
  catch { throw new Error(`商品一覧を読み込めませんでした。時間をおいて再度お試しください。 (監査ID: ${auditId})`); }
  return (
    <main className={styles.main}>
      <div className={styles.heading}><div><h1>A02 商品管理</h1><p>商品情報、仕様、画像、公開状態を管理します。</p></div><Link href="/admin/products/new" className={styles.primary}>新規商品</Link></div>
      <form className={styles.search} action="/admin/products" method="get">
        <label htmlFor="product-search">商品名・ブランド・SKU・slug</label>
        <div><input id="product-search" name="q" type="search" maxLength={100} defaultValue={q} /><button type="submit">検索</button></div>
      </form>
      {products.length === 0 ? <section className={styles.empty} aria-live="polite"><h2>商品が見つかりません</h2><p>検索語を変更するか、新しい商品を登録してください。</p></section> : (
        <div className={styles.tableWrap}><table>
          <thead><tr><th>商品</th><th>カテゴリ</th><th>SKU</th><th>税込価格</th><th>状態</th><th>更新日</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{products.map((product) => <tr key={product.id}>
            <td><strong>{product.name || '名称未設定'}</strong><small>{product.brand} · {product.slug}</small></td>
            <td>{labels[product.category]}</td><td>{product.sku}</td>
            <td>{product.priceTaxIncludedYen === null ? '未設定' : `¥${product.priceTaxIncludedYen.toLocaleString('ja-JP')}`}</td>
            <td><span className={`${styles.status} ${styles[product.status]}`}>{statusLabels[product.status]}</span></td>
            <td><time dateTime={product.updatedAt}>{new Date(product.updatedAt).toLocaleDateString('ja-JP')}</time></td>
            <td><Link href={`/admin/products/${product.id}`}>編集</Link></td>
          </tr>)}</tbody>
        </table></div>
      )}
      <p className={styles.audit}>最大100件を表示しています。監査ID: <code>{auditId}</code></p>
    </main>
  );
}
