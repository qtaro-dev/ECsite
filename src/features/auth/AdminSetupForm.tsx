'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './auth.module.css';

export function AdminSetupForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, setupCode }) });
      const result = await response.json() as { data?: { message?: string }; error?: { message?: string } };
      if (!response.ok) { setMessage(result.error?.message ?? '処理できませんでした。'); return; }
      setSetupCode(''); setPassword(''); setMessage(result.data?.message ?? '作成しました。');
      router.push('/admin-login');
    } catch { setMessage('通信できませんでした。時間をおいて再度お試しください。'); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <label htmlFor="setup-code">初回セットアップコード</label>
    <input id="setup-code" type="password" autoComplete="off" required minLength={32} maxLength={512} value={setupCode} onChange={e => setSetupCode(e.target.value)} />
    <label htmlFor="owner-email">管理者メールアドレス</label>
    <input id="owner-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
    <label htmlFor="owner-password">パスワード（12文字以上）</label>
    <input id="owner-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} />
    <p className={styles.notice}>この画面は管理者が一人も登録されていない場合だけ利用できます。コードはURLや保存欄に入れないでください。</p>
    {message && <p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? '作成中…' : '管理者アカウントを作成'}</button>
  </form>;
}
