import Link from 'next/link';
import { AuthPage } from '@/features/auth/AuthPage';
import { AdminLoginForm } from '@/features/auth/AdminLoginForm';

export default function AdminLoginPage() {
  return <AuthPage><h1>管理者ログイン</h1><AdminLoginForm />
    <p><Link href="/admin-setup">初回管理者セットアップ</Link></p>
  </AuthPage>;
}
