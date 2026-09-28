'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { demoAuthFailure } from '@/lib/demo-auth';
import styles from './auth.module.css';

type DemoAuth = Pick<ReturnType<typeof createBrowserClient>['auth'], 'getUser' | 'signInAnonymously'>;

export async function startDemoSession(auth: DemoAuth, merge: () => Promise<Response>): Promise<{ ok: true; mergeWarning: boolean } | { ok: false; message: string }> {
  let current;
  try { current = await auth.getUser(); }
  catch { return { ok: false, message: demoAuthFailure() }; }
  if (current.error && current.error.name !== 'AuthSessionMissingError') return { ok: false, message: demoAuthFailure(current.error.code, current.error.status) };
  if (!current.data.user) {
    let created;
    try { created = await auth.signInAnonymously(); }
    catch { return { ok: false, message: demoAuthFailure() }; }
    if (created.error || !created.data.user) return { ok: false, message: demoAuthFailure(created.error?.code, created.error?.status) };
  }
  try {
    const response = await merge();
    return { ok: true, mergeWarning: !response.ok };
  } catch { return { ok: true, mergeWarning: true }; }
}

export function DemoStart({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error('Supabase is not configured');
      const auth = createBrowserClient(url, key).auth;
      const result = await startDemoSession(auth, () => fetch('/api/cart/merge', { method: 'POST', cache: 'no-store', credentials: 'same-origin' }));
      if (!result.ok) { setMessage(result.message); return; }
      if (result.mergeWarning) {
        setMessage('デモ会員は開始できましたが、カートを統合できませんでした。カートを開いて内容を確認してください。');
        router.replace('/cart');
      } else {
        router.replace(returnTo);
      }
      router.refresh();
    } catch { setMessage(demoAuthFailure()); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section aria-labelledby="demo-start-heading" className={styles.demoPanel}>
    <h2 id="demo-start-heading">デモ会員で購入体験</h2>
    <p>メールアドレス・電話番号なしで開始できます。閲覧者ごとにデータを分離します。実販売・課金・発送はありません。</p>
    <p>終了後やCookieを消した後に、このデモ会員へ戻ることはできません。個人情報は入力しないでください。</p>
    <button className={styles.demoButton} type="button" onClick={() => void start()} disabled={busy}>{busy ? '開始中…' : 'デモを開始・再開'}</button>
    {message && <p role="alert" className={styles.error}>{message}</p>}
  </section>;
}
