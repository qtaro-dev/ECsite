'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './admin.module.css';

export function AdminLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('logout failed');
      router.replace('/admin-login');
      router.refresh();
    } catch {
      setError('ログアウトできませんでした。時間をおいて再度お試しください。');
      setBusy(false);
    }
  }

  return <div className={styles.adminSession}>
    {error && <p className={styles.logoutError} role="alert">{error}</p>}
    <button className={styles.logoutButton} type="button" onClick={logout} disabled={busy}>
      {busy ? '処理中…' : '管理者ログアウト'}
    </button>
  </div>;
}
