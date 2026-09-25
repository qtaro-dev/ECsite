'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './auth.module.css';

type AuthFormProps = { mode: 'login' | 'register'; returnTo?: string };
type ApiResult = { data?: { message?: string; returnTo?: string }; error?: { message?: string; fieldErrors?: Record<string, string[]> } };

export function AuthForm({ mode, returnTo }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setFieldErrors({});
    setBusy(true);
    try {
      const query = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
      const response = await fetch(`/api/auth/${register ? 'register' : 'login'}${query}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(register
          ? { email, password, passwordConfirmation, acceptedTerms }
          : { email, password }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok) {
        setFieldErrors(result.error?.fieldErrors ?? {});
        setMessage(result.error?.message ?? '処理できませんでした。入力内容を確認してください。');
      } else if (register) {
        const queryEmail = encodeURIComponent(email);
        router.push(`/verify?email=${queryEmail}${returnTo ? `&next=${encodeURIComponent(returnTo)}` : ''}`);
      } else {
        router.replace(result.data?.returnTo ?? '/account');
        router.refresh();
      }
    } catch {
      setMessage('通信できませんでした。時間をおいて再度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="auth-email">メールアドレス</label>
    <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} aria-invalid={Boolean(fieldErrors.email)}
      value={email} onChange={(event) => setEmail(event.target.value)} />
      {fieldErrors.email?.map((error, index) => <p key={index} className={styles.error}>{error}</p>)}
      <label htmlFor="auth-password">パスワード</label>
      <input id="auth-password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} aria-invalid={Boolean(fieldErrors.password)}
        required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
      {fieldErrors.password?.map((error, index) => <p key={index} className={styles.error}>{error}</p>)}
      {register && <>
        <label htmlFor="auth-password-confirmation">パスワード（確認）</label>
      <input id="auth-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" aria-invalid={Boolean(fieldErrors.passwordConfirmation)}
          required minLength={12} maxLength={128} value={passwordConfirmation}
          onChange={(event) => setPasswordConfirmation(event.target.value)} />
        {fieldErrors.passwordConfirmation?.map((error, index) => <p key={index} className={styles.error}>{error}</p>)}
        <p className={styles.notice}>実販売・課金・発送は行いません。登録情報は認証と会員機能に使い、30日以内に削除します。</p>
        <label className={styles.checkbox}>
          <input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
          規約と個人情報の取り扱いを確認しました
        </label>
      </>}
      {message && <p className={styles.error} role="alert">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? '処理中…' : register ? '確認メールを送る' : 'ログイン'}</button>
    </form>
  );
}

export function ResendConfirmationForm({ email: initialEmail, returnTo }: { email: string; returnTo?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const query = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
      const response = await fetch(`/api/auth/verify/resend${query}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const result = await response.json() as ApiResult;
      setMessage(response.ok ? result.data?.message ?? '確認メールを送信しました。' : result.error?.message ?? '再送できませんでした。');
    } catch { setMessage('通信できませんでした。時間をおいて再度お試しください。'); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <label htmlFor="resend-email">確認メールの送信先</label>
    <input id="resend-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
    <button type="submit" disabled={busy}>{busy ? '送信中…' : '確認メールを再送する'}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
