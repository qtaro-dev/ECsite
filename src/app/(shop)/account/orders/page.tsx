import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StatusMessage } from '@/components/StatusMessage';
import { describeOrderState } from '@/lib/order-display';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { listOwnedOrders } from '@/server/orders/order-read';
import styles from '@/features/orders/orders.module.css';

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const pageParam = (await searchParams).page;
  const page = pageParam && /^[1-9][0-9]*$/.test(pageParam) ? Number(pageParam) : 1;
  if (!Number.isSafeInteger(page)) return <main className={styles.page}><StatusMessage kind="error" title="ページを表示できません">ページ番号を確認してください。</StatusMessage></main>;
  let client;
  try { client = await createSupabaseServerClient(); } catch { return <main className={styles.page}><StatusMessage kind="error" title="注文履歴を読み込めません">時間をおいて再度お試しください。</StatusMessage></main>; }
  let auth;
  try { auth = await client.auth.getUser(); } catch { return <main className={styles.page}><StatusMessage kind="error" title="注文履歴を読み込めません">時間をおいて再度お試しください。</StatusMessage></main>; }
  if (auth.error && !isAuthSessionMissing(auth.error)) return <main className={styles.page}><StatusMessage kind="error" title="注文履歴を読み込めません">時間をおいて再度お試しください。</StatusMessage></main>;
  const user = auth.data.user;
  if (!user) redirect('/login?next=%2Faccount%2Forders');
  let result;
  try { result = await listOwnedOrders(client, user.id, page); } catch { return <main className={styles.page}><StatusMessage kind="error" title="注文履歴を読み込めません">時間をおいて再度お試しください。</StatusMessage></main>; }
  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <nav aria-label="パンくず"><Link href="/account">会員メニュー</Link> / 注文履歴</nav>
    <p className={styles.eyebrow}>ORDER HISTORY</p><h1>注文履歴</h1>
    {result.orders.length === 0 ? <StatusMessage kind="info" title={page === 1 ? '注文はまだありません' : 'このページに注文はありません'}><p>商品を探して、テスト購入を体験できます。</p><Link href={page === 1 ? '/products' : '/account/orders'}>{page === 1 ? '商品を探す' : '最初のページへ'}</Link></StatusMessage>
      : <><p>新しい順に20件ずつ表示しています。</p><ul className={styles.orderList}>{result.orders.map((order) => <li key={order.id}>
        <Link href={`/account/orders/${order.id}`}><span><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleString('ja-JP')}</time><strong>{describeOrderState(order.status).title}</strong></span><span>{order.grand_total_yen.toLocaleString('ja-JP')}円</span></Link>
      </li>)}</ul><nav className={styles.actions} aria-label="注文履歴のページ">{page > 1 && <Link href={`/account/orders?page=${page - 1}`}>前のページ</Link>}<span>{page} ページ</span>{result.hasNext && <Link href={`/account/orders?page=${page + 1}`}>次のページ</Link>}</nav></>}
  </main>;
}
