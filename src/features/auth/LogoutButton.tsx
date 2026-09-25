'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './auth.module.css';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      router.replace('/'); router.refresh();
    } catch { setError('ログアウトできませんでした。時間をおいて再度お試しください。'); setBusy(false); }
  }
  return <>
    <button className={styles.logout} type="button" onClick={logout} disabled={busy}>{busy ? '処理中…' : 'ログアウト'}</button>
    {error && <p role="alert">{error}</p>}
  </>;
}
