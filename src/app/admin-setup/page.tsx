import Link from 'next/link';
import { AuthPage } from '@/features/auth/AuthPage';
import { AdminSetupForm } from '@/features/auth/AdminSetupForm';
import { isFirstAdminSetupOpen } from '@/server/admin/bootstrap';

export const dynamic = 'force-dynamic';
export default async function AdminSetupPage() {
  let available = false;
  try { available = await isFirstAdminSetupOpen(); } catch { /* Fail closed if membership state cannot be checked. */ }
  return <AuthPage><h1>初回管理者セットアップ</h1>
    {available ? <AdminSetupForm /> : <p role="status">初回セットアップは利用できません。管理者ログインをご利用ください。</p>}
    <p><Link href="/admin-login">管理者ログイン</Link></p>
  </AuthPage>;
}
