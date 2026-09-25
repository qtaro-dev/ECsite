import { redirect } from 'next/navigation';
import { AuthPage } from '@/features/auth/AuthPage';
import { LogoutButton } from '@/features/auth/LogoutButton';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Faccount');
  return <AuthPage>
    <h1>会員メニュー</h1>
    <p>ログイン中のメールアドレス: {user.email}</p>
    <p>注文を開始するにはメール確認と登録時のSMSコード照合が必要です。</p>
    <LogoutButton />
  </AuthPage>;
}
