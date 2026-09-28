import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StatusMessage } from '@/components/StatusMessage';
import { LogoutButton } from '@/features/auth/LogoutButton';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import styles from './account.module.css';
import { isDemoUser } from '@/lib/demo-auth';
import { DeleteDemoAccount } from '@/features/account/DeleteDemoAccount';

export default async function AccountPage() {
  let supabase;
  try { supabase = await createSupabaseServerClient(); } catch { redirect('/login?next=%2Faccount'); }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login?next=%2Faccount');
  const [{ count: addressCount, error: addressError }, { count: orderCount, error: orderError }] = await Promise.all([
    supabase.from('addresses').select('id', { count: 'exact', head: true }),
    supabase.from('orders').select('id', { count: 'exact', head: true }),
  ]);
  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <p className={styles.eyebrow}>MY ACCOUNT</p><h1>会員メニュー</h1>
    <p>{isDemoUser(user) ? 'デモ会員として利用中です。' : `ログイン中のメールアドレス: ${user.email ?? '未設定'}`}</p>
    <LogoutButton demo={isDemoUser(user)} />
    <p>配送先と注文履歴を確認できます。</p>
    {(addressError || orderError) && <StatusMessage kind="error" title="会員情報を読み込めませんでした"><p>時間をおいて再読み込みしてください。</p></StatusMessage>}
    <div className={styles.grid}>
      <Link className={styles.card} href="/account/addresses"><span className={styles.cardTitle}>配送先</span><span>{addressError ? '確認できません' : `${addressCount ?? 0} 件登録`}</span><span className={styles.action}>配送先を管理 →</span></Link>
      <Link className={styles.card} href="/account/orders"><span className={styles.cardTitle}>注文履歴</span><span>{orderError ? '確認できません' : `${orderCount ?? 0} 件`}</span><span className={styles.action}>注文履歴を見る →</span></Link>
    </div>
    <StatusMessage kind="info" title="公開デモの個人情報について"><p>実際の商品販売・課金・発送はありません。デモ配送先は架空データだけを自動作成します。デモ会員の情報は作成から30日後に削除ジョブの対象となります。</p></StatusMessage>
    {isDemoUser(user) && <DeleteDemoAccount />}
  </main>;
}
