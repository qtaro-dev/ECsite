'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './orders.module.css';

/** Runs only after a server-confirmed paid status. Failure never changes the payment result. */
export function PaidCartCleanup({ orderId }: { orderId: string }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const cleanup = useCallback(async () => {
    setState('running');
    try {
      const response = await fetch('/api/checkout/cart-cleanup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      if (!response.ok) throw new Error('cleanup failed');
      setState('done');
    } catch { setState('failed'); }
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void cleanup(); }, 0);
    return () => window.clearTimeout(timer);
  }, [cleanup]);

  if (state === 'failed') return <p className={styles.cleanupNotice}>支払いは完了しています。カートの整理に失敗したため、必要なら再試行してください。 <button className={styles.secondary} type="button" onClick={() => void cleanup()}>カートを整理する</button></p>;
  if (state === 'running') return <p className={styles.note} role="status">購入済み商品をカートから整理しています。</p>;
  return null;
}
