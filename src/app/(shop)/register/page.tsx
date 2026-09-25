import Link from 'next/link';
import { AuthForm } from '@/features/auth/AuthForm';
import { AuthPage } from '@/features/auth/AuthPage';
import { safeReturnPath } from '@/server/auth/safe-return-path';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  const returnTo = safeReturnPath(query.next);
  return <AuthPage>
    <h1>新規会員登録</h1>
    <p>登録後、メール内のリンクを開いてメールアドレスを確認してください。注文開始には別途、登録時のSMS確認も必要です。</p>
    <AuthForm mode="register" returnTo={returnTo} />
    <p><Link href={`/login?next=${encodeURIComponent(returnTo)}`}>ログインはこちら</Link></p>
  </AuthPage>;
}
