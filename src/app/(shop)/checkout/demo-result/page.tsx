import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IdSchema } from '@/lib/schemas';
import { isDemoUser } from '@/lib/demo-auth';
import { createCartServiceClient } from '@/server/cart/service-client';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import styles from '../review/page.module.css';

export const dynamic = 'force-dynamic';

export default async function DemoCheckoutResultPage({ searchParams }: { searchParams: Promise<{ quoteId?: string }> }) {
  const params = await searchParams;
  const quoteId = IdSchema.safeParse(params.quoteId);
  if (!quoteId.success) redirect('/checkout/address');
  let client;
  try { client = await createSupabaseServerClient(); } catch { redirect('/login?next=%2Fcheckout%2Faddress'); }
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect('/login?next=%2Fcheckout%2Faddress');
  if (!isDemoUser(user)) redirect('/checkout/address');
  let serviceClient;
  try { serviceClient = createCartServiceClient(); } catch { redirect('/checkout/address'); }
  const result = await serviceClient.from('checkout_quotes').select('demo_completed_at')
    .eq('id', quoteId.data).eq('user_id', user.id).maybeSingle();
  if (result.error || !result.data?.demo_completed_at) redirect('/checkout/address');

  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <p className={styles.eyebrow}>DEMO CHECKOUT</p>
    <h1>デモ購入が完了しました</h1>
    <section className={styles.notice} role="status" aria-live="polite">
      <p><strong>実際の決済・注文・発送は行われません。</strong></p>
      <p>架空の配送先と見積を使った購入操作のデモです。この完了操作でカートを空にしました。あとから追加した商品はそのまま残ります。</p>
    </section>
    <p><Link href="/cart">カートを見る</Link></p>
    <p><Link href="/">商品を探す</Link></p>
  </main>;
}
