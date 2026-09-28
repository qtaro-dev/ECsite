import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { StatusMessage } from '@/components/StatusMessage';
import { describeOrderState } from '@/lib/order-display';
import { IdSchema } from '@/lib/schemas';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { readOwnedOrderDetail } from '@/server/orders/order-read';
import { PaidCartCleanup } from '@/features/orders/PaidCartCleanup';
import styles from '@/features/orders/orders.module.css';

const prefectures = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  let client;
  try { client = await createSupabaseServerClient(); } catch { return <main className={styles.page}><StatusMessage kind="error" title="注文を読み込めません">時間をおいて再度お試しください。</StatusMessage></main>; }
  let auth;
  try { auth = await client.auth.getUser(); } catch { return <main className={styles.page}><StatusMessage kind="error" title="注文を読み込めません">時間をおいて再度お試しください。</StatusMessage></main>; }
  if (auth.error && !isAuthSessionMissing(auth.error)) return <main className={styles.page}><StatusMessage kind="error" title="注文を読み込めません">時間をおいて再度お試しください。</StatusMessage></main>;
  const user = auth.data.user;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/account/orders/${id}`)}`);
  let detail;
  try { detail = await readOwnedOrderDetail(client, user.id, id); } catch { return <main className={styles.page}><StatusMessage kind="error" title="注文を読み込めません">時間をおいて再度お試しください。</StatusMessage></main>; }
  if (!detail) notFound();
  const { order, items } = detail;
  const state = describeOrderState(order.status);
  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <nav aria-label="パンくず"><Link href="/account/orders">注文履歴</Link> / 注文詳細</nav>
    <p className={styles.eyebrow}>ORDER DETAIL</p><h1>注文詳細</h1>
    <p className={styles.orderId}>注文ID: {order.id}</p><p>注文日時: <time dateTime={order.created_at}>{new Date(order.created_at).toLocaleString('ja-JP')}</time></p>
    <StatusMessage kind={state.kind} title={state.title}><p>{state.guidance}</p>{state.retryEligible && <Link href="/cart">カートを確認して再見積する</Link>}{(order.status === 'payment_pending' || order.status === 'review_required') && <Link href={`/checkout/result?orderId=${order.id}`}>最新の決済状況を確認する</Link>}</StatusMessage>
    {order.status === 'paid' && <PaidCartCleanup orderId={order.id} />}
    <section className={styles.card}><h2>注文時の商品</h2><ul className={styles.itemList}>{items.map((item) => <li key={item.id}>
      <span><strong>{item.name_snapshot}</strong><small>{item.brand_snapshot} / {item.sku_snapshot}</small></span>
      <span>{item.unit_price_yen.toLocaleString('ja-JP')}円 × {item.quantity} = {item.line_total_yen.toLocaleString('ja-JP')}円</span>
    </li>)}</ul></section>
    <section className={styles.card}><h2>注文時のお届け先</h2><address>{order.address_snapshot.recipientName}<br />〒{order.address_snapshot.postalCode}<br />{prefectures[order.address_snapshot.prefectureCode - 1]}{order.address_snapshot.city}{order.address_snapshot.street}<br />{order.address_snapshot.building}</address></section>
    <section className={styles.card}><h2>注文時の金額</h2><dl className={styles.totals}>
      <div><dt>商品小計（税込）</dt><dd>{order.goods_total_yen.toLocaleString('ja-JP')}円</dd></div>
      <div><dt>通常送料</dt><dd>{order.shipping_base_yen.toLocaleString('ja-JP')}円</dd></div>
      <div><dt>重量物送料</dt><dd>{order.shipping_heavy_yen.toLocaleString('ja-JP')}円</dd></div>
      <div><dt>送料合計</dt><dd>{order.shipping_total_yen.toLocaleString('ja-JP')}円</dd></div>
      <div><dt>内税（10%）</dt><dd>{order.tax_total_yen.toLocaleString('ja-JP')}円</dd></div>
      <div className={styles.grand}><dt>注文合計</dt><dd>{order.grand_total_yen.toLocaleString('ja-JP')}円</dd></div>
    </dl><p className={styles.note}>送料規則版: {order.shipping_rule_version}</p></section>
    <p className={styles.note}>商品・配送先・金額は注文時点の記録です。現在の商品情報や配送先を変更しても、この記録は変わりません。</p>
  </main>;
}
