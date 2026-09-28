'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './delete-demo-account.module.css';

export function DeleteDemoAccount() {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [message, setMessage] = useState('');

  async function remove() {
    if (busy || confirmation !== 'アカウントを削除') return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      });
      const body = await response.json() as { data?: { status: 'deleted' | 'deferred' | 'queued' }; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? '削除できませんでした。再試行してください。');
      window.sessionStorage.removeItem('checkoutQuote');
      window.sessionStorage.removeItem('checkoutIdempotencyKey');
      if (body.data?.status === 'deleted') { router.replace('/'); router.refresh(); return; }
      setQueued(true);
      setMessage('削除を受け付けました。決済状態の確認後、15分間隔のジョブが自動で再試行します。注文は新たに作成できません。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '削除できませんでした。再試行してください。'); }
    finally { setBusy(false); }
  }

  return <section className={styles.section} aria-labelledby="delete-demo-heading">
    <h2 id="delete-demo-heading">デモ会員を削除</h2>
    <p>このデモ会員の架空配送先、カート、注文履歴、認証情報を削除します。操作は取り消せません。決済確認中は安全に終了するまで削除を保留します。</p>
    <label htmlFor="demo-delete-confirmation">確認のため「アカウントを削除」と入力してください</label>
    <input id="demo-delete-confirmation" value={confirmation} disabled={busy || queued}
      autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} />
    <button type="button" disabled={busy || queued || confirmation !== 'アカウントを削除'} onClick={remove}>
      {busy ? '削除を確認中…' : 'デモ会員を削除する'}
    </button>
    {message && <p role={queued ? 'status' : 'alert'}>{message}</p>}
  </section>;
}
