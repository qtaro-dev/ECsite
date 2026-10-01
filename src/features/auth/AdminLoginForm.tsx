'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './auth.module.css';

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const result = await response.json() as { data?: { returnTo?: string }; error?: { message?: string } };
      if (!response.ok) { setMessage(result.error?.message ?? 'ログインできませんでした。'); return; }
      router.replace(result.data?.returnTo ?? '/admin'); router.refresh();
    } catch { setMessage('通信できませんでした。時間をおいて再度お試しください。'); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <label htmlFor="admin-email">メールアドレス</label>
    <input id="admin-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
    <label htmlFor="admin-password">パスワード</label>
    <input id="admin-password" type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} />
    {message && <p className={styles.error} role="alert">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'ログイン中…' : '管理者ログイン'}</button>
  </form>;
}
