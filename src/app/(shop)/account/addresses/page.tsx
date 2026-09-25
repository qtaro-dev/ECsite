import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StatusMessage } from '@/components/StatusMessage';
import { AddressManager } from '@/features/account/AddressManager';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { safeReturnPath } from '@/server/auth/safe-return-path';
import { ADDRESS_SELECT, type AddressRow } from '@/server/account/addresses';
import styles from './page.module.css';

export default async function AddressesPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  const returnTo = safeReturnPath(query.next);
  let supabase;
  try { supabase = await createSupabaseServerClient(); } catch { redirect(`/login?next=${encodeURIComponent('/account/addresses')}`); }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect(`/login?next=${encodeURIComponent('/account/addresses')}`);
  const { data, error } = await supabase.from('addresses').select(ADDRESS_SELECT).order('is_default', { ascending: false }).order('created_at', { ascending: false });
  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <nav aria-label="パンくず"><Link href="/account">会員メニュー</Link> / 配送先</nav>
    <p className={styles.eyebrow}>DELIVERY DETAILS</p><h1>配送先の管理</h1>
    {error ? <StatusMessage kind="error" title="配送先を読み込めませんでした"><p>時間をおいて再読み込みしてください。</p></StatusMessage>
      : <AddressManager initialAddresses={(data as AddressRow[]).map((row) => ({ id: row.id, recipientName: row.recipient_name, postalCode: row.postal_code, prefectureCode: row.prefecture_code, city: row.city, street: row.street, building: row.building, isDefault: row.is_default }))} returnTo={returnTo} />}
  </main>;
}
