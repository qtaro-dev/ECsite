import Link from 'next/link';
import { AuthForm } from '@/features/auth/AuthForm';
import { AuthPage } from '@/features/auth/AuthPage';
import { safeReturnPath } from '@/server/auth/safe-return-path';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const query = await searchParams;
  const returnTo = safeReturnPath(query.next);
  return <AuthPage>
    <h1>ログイン</h1>
    <p>メールアドレスとパスワードでログインしてください。通常ログインにSMS認証はありません。</p>
    {query.error === 'google' && <p role="alert">Googleログインを完了できませんでした。もう一度お試しください。</p>}
    <p><Link href={`/api/auth/google?next=${encodeURIComponent(returnTo)}`}>Googleでログイン・登録</Link></p>
    <AuthForm mode="login" returnTo={returnTo} />
    <p><Link href={`/register?next=${encodeURIComponent(returnTo)}`}>新規会員登録</Link></p>
    <p><Link href={`/verify?next=${encodeURIComponent(returnTo)}`}>確認メールが届かない場合</Link></p>
  </AuthPage>;
}
