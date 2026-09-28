'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckoutStatusResultSchema, describeOrderState } from '@/lib/order-display';
import { IdSchema } from '@/lib/schemas';
import { StatusMessage } from '@/components/StatusMessage';
import { PaidCartCleanup } from './PaidCartCleanup';
import styles from './orders.module.css';

type Status = ReturnType<typeof CheckoutStatusResultSchema['parse']>;

export function CheckoutResult({ orderId }: { orderId: string | null }) {
  const parsedId = IdSchema.safeParse(orderId);
  const validOrderId = parsedId.success ? parsedId.data : null;
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<{ code: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!validOrderId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/checkout/status?orderId=${encodeURIComponent(validOrderId)}`, { cache: 'no-store' });
      const body: unknown = await response.json();
      if (!response.ok) {
        const envelope = body && typeof body === 'object' && 'error' in body ? body.error : null;
        const message = envelope && typeof envelope === 'object' && 'message' in envelope && typeof envelope.message === 'string'
          ? envelope.message : '注文状況を読み込めませんでした。';
        setError({ code: response.status, message });
        setStatus(null);
        return;
      }
      const data = body && typeof body === 'object' && 'data' in body ? body.data : null;
      const parsed = CheckoutStatusResultSchema.safeParse(data);
      if (!parsed.success) throw new Error('invalid response');
      setStatus(parsed.data);
      setError(null);
    } catch {
      setError({ code: 503, message: '注文状況を確認できません。通信状態を確認して再度お試しください。' });
    } finally {
      setLoading(false);
      setRefreshCount((count) => count + 1);
    }
  }, [validOrderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (status?.status !== 'payment_pending' || refreshCount >= 24) return;
    const timer = window.setTimeout(() => { void refresh(); }, 5000);
    return () => window.clearTimeout(timer);
  }, [status?.status, refreshCount, refresh]);

  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <nav aria-label="パンくず"><Link href="/">ホーム</Link> / 決済結果</nav>
    <p className={styles.eyebrow}>ORDER STATUS</p><h1>決済結果</h1>
    {!parsedId.success && <StatusMessage kind="error" title="注文を確認できません"><p>注文IDがありません。注文履歴から確認してください。</p></StatusMessage>}
    {parsedId.success && !status && !error && <StatusMessage kind="info" title="注文状況を読み込み中"><p>決済通知の状態を確認しています。</p></StatusMessage>}
    {error && <StatusMessage kind={error.code === 404 ? 'warning' : 'error'} title={error.code === 404 ? '注文が見つかりません' : '注文状況を確認できません'}>
      <p>{error.message}</p>{error.code === 401 ? <Link href={`/login?next=${encodeURIComponent(`/checkout/result?orderId=${orderId}`)}`}>ログインする</Link> : error.code !== 404 && <button className={styles.secondary} onClick={() => void refresh()} disabled={loading}>再読み込み</button>}
    </StatusMessage>}
    {status && <StatusMessage kind={describeOrderState(status.status).kind} title={describeOrderState(status.status).title}>
      <p>{status.guidance}</p>
      {status.status === 'payment_pending' && <button className={styles.secondary} onClick={() => void refresh()} disabled={loading}>{loading ? '確認中…' : '最新の状態を確認'}</button>}
      {status.status === 'review_required' && <button className={styles.secondary} onClick={() => void refresh()} disabled={loading}>最新の状態を確認</button>}
      {status.retryEligible && <Link href="/cart">カートを確認して再見積する</Link>}
    </StatusMessage>}
    {status?.status === 'paid' && parsedId.success && <PaidCartCleanup orderId={parsedId.data} />}
    {parsedId.success && <p className={styles.orderId}>注文ID: {parsedId.data}</p>}
    <div className={styles.actions}><Link href={parsedId.success ? `/account/orders/${parsedId.data}` : '/account/orders'}>注文の詳細を見る</Link><Link href="/account/orders">注文履歴へ</Link><Link href="/products">商品を探す</Link></div>
    <p className={styles.note}>このサイトはポートフォリオ用の模擬販売です。実際の課金・発送はありません。</p>
  </main>;
}
