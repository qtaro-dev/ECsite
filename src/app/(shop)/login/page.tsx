import Link from 'next/link';
import { AuthForm } from '@/features/auth/AuthForm';
import { AuthPage } from '@/features/auth/AuthPage';
import { DemoStart } from '@/features/auth/DemoStart';
import { safeReturnPath } from '@/server/auth/safe-return-path';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  const returnTo = safeReturnPath(query.next);
  return <AuthPage>
    <h1>購入体験を始める</h1>
    <DemoStart returnTo={returnTo} />
    {process.env.NODE_ENV !== 'production' && <section>
      <h2>開発・テスト用ログイン</h2>
      <AuthForm mode="login" returnTo={returnTo} />
      <p><Link href={`/register?next=${encodeURIComponent(returnTo)}`}>開発用の会員登録</Link></p>
      <p><Link href={`/verify?next=${encodeURIComponent(returnTo)}`}>確認メールの再送</Link></p>
    </section>}
  </AuthPage>;
}
