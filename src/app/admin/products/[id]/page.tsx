import { notFound } from 'next/navigation';
import { AdminProductEditor } from '../ProductEditor';
import styles from '../products.module.css';
import { getAdminProduct } from '@/server/admin/products';

export const dynamic = 'force-dynamic';

export default async function EditAdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let product;
  try { product = await getAdminProduct(id); }
  catch { throw new Error('商品情報を読み込めませんでした。時間をおいて再度お試しください。'); }
  if (!product) notFound();
  return <main className={styles.main}><div className={styles.heading}><div><h1>商品を編集</h1><p>{product.sku} · {product.slug}</p></div></div><AdminProductEditor initial={product} /></main>;
}
