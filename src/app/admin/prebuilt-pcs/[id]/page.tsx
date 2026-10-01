import { notFound } from 'next/navigation';
import Link from 'next/link';
import styles from '../../products/products.module.css';
import PrebuiltPcEditor from '../PrebuiltPcEditor';
import { getPrebuiltPcById } from '@/server/admin/prebuilt-pcs';

export const dynamic = 'force-dynamic';

export default async function EditPrebuiltPcPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  let product;
  try { product = await getPrebuiltPcById(id); }
  catch { throw new Error('構成済みPCを読み込めませんでした。時間をおいて再度お試しください。'); }
  if (!product) notFound();
  return <main className={styles.main}>
    <div className={styles.heading}><div><h1>構成済みPCを編集</h1><p>{product.sku} · {product.slug}</p></div><Link href="/admin/products" className={styles.primary}>商品一覧</Link></div>
    <PrebuiltPcEditor initial={product} initialMessage={query.saved === '1' ? '構成済みPCを保存しました。' : undefined} />
  </main>;
}
