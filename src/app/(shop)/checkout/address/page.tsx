import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { ADDRESS_SELECT, type AddressRow } from '@/server/account/addresses';
import { CheckoutAddressForm } from './CheckoutAddressForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function CheckoutAddressPage() {
  let supabase;
  try { supabase = await createSupabaseServerClient(); } catch { redirect('/login?next=%2Fcheckout%2Faddress'); }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login?next=%2Fcheckout%2Faddress');
  const { data, error } = await supabase.from('addresses').select(ADDRESS_SELECT)
    .order('is_default', { ascending: false }).order('created_at', { ascending: false });
  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <nav aria-label="パンくず"><a href="/cart">カート</a> / 配送先</nav>
    <p className={styles.eyebrow}>S12 / CHECKOUT ADDRESS</p>
    <h1>お届け先を選択</h1>
    <p className={styles.lead}>お届け先を確認してから、現在の商品価格・在庫・正式送料を再計算します。実際の販売・発送は行いません。</p>
    {error ? <section className={styles.error} role="alert"><h2>配送先を読み込めませんでした</h2><p>時間をおいて再読み込みしてください。</p></section>
      : <CheckoutAddressForm addresses={(data as AddressRow[]).map((row) => ({
        id: row.id, recipientName: row.recipient_name, postalCode: row.postal_code,
        prefectureCode: row.prefecture_code, city: row.city, street: row.street,
        building: row.building, isDefault: row.is_default,
      }))} />}
  </main>;
}
