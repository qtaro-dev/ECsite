import Link from 'next/link';
import { ResendConfirmationForm } from '@/features/auth/AuthForm';
import { AuthPage } from '@/features/auth/AuthPage';
import { safeReturnPath } from '@/server/auth/safe-return-path';

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string; next?: string; result?: string; confirmed?: string }> }) {
  const query = await searchParams;
  const email = query.email ?? '';
  const returnTo = safeReturnPath(query.next);
  return <AuthPage>
    <h1>メールアドレスの確認</h1>
    {query.confirmed === '1'
      ? <p>メールアドレスを確認しました。注文開始には登録時のSMSコード照合も必要です。</p>
      : query.result === 'link-invalid'
      ? <p role="alert">確認リンクの期限が切れたか、すでに使用されています。確認メールを再送してください。</p>
      : <p>確認メールを開いてリンクを選択してください。登録メールが確認されるまで注文を開始できません。</p>}
    <p>メール確認とは別に、登録時のSMSコード照合も注文開始条件です。SMS確認では公開デモの模擬通知を使い、実際の電話番号は収集しません。</p>
    <ResendConfirmationForm email={email} returnTo={returnTo} />
    <p><Link href={`/login?next=${encodeURIComponent(returnTo)}`}>ログインへ戻る</Link></p>
  </AuthPage>;
}
