import { notFound } from 'next/navigation';
import Link from 'next/link';
import styles from '../../products/products.module.css';
import PrebuiltPcEditor from '../PrebuiltPcEditor';
import { getPrebuiltPcById } from '@/server/admin/prebuilt-pcs';

export const dynamic = 'force-dynamic';

export default async function EditPrebuiltPcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let product;
  try { product = await getPrebuiltPcById(id); }
  catch { throw new Error('構成済みPCを読み込めませんでした。時間をおいて再度お試しください。'); }
  if (!product) notFound();
  return <main className={styles.main}>
    <div className={styles.heading}><div><h1>構成済みPCを編集</h1><p>{product.sku} · {product.slug}</p></div><Link href="/admin/products" className={styles.primary}>商品一覧</Link></div>
    <PrebuiltPcEditor initial={product} />
  </main>;
}
