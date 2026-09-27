'use client';

import { useState } from 'react';
import { z } from 'zod';
import { AdminInventoryResponseSchema, AdminInventoryStateSchema } from '@/lib/admin-inventory-schemas';
import styles from './inventory.module.css';

type Inventory = z.infer<typeof AdminInventoryResponseSchema>;
type ErrorBody = { error?: { message?: string }; data?: { latest?: unknown } };

export default function InventoryManager({ initialInventory }: { initialInventory: Inventory }) {
  const [items, setItems] = useState(initialInventory.items);
  const [adjustments, setAdjustments] = useState(initialInventory.adjustments);
  const [page, setPage] = useState(initialInventory.page);
  const [totalPages, setTotalPages] = useState(initialInventory.totalPages);
  const [total, setTotal] = useState(initialInventory.total);
  const [pageBusy, setPageBusy] = useState(false);
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, { kind: 'success' | 'error'; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function loadPage(nextPage: number) {
    if (pageBusy || busy || nextPage < 1 || nextPage > totalPages) return;
    setPageBusy(true);
    try {
      const response = await fetch(`/api/admin/inventory?page=${nextPage}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('在庫一覧を読み込めませんでした。時間をおいて再度お試しください。');
      const body = await response.json() as { data?: unknown };
      const result = AdminInventoryResponseSchema.parse(body.data);
      setItems(result.items); setAdjustments(result.adjustments); setPage(result.page); setTotalPages(result.totalPages); setTotal(result.total);
    } catch (error) {
      setMessages((all) => ({ ...all, _page: { kind: 'error', text: error instanceof Error ? error.message : '在庫一覧を読み込めませんでした。' } }));
    } finally { setPageBusy(false); }
  }

  async function submit(productId: string) {
    const current = items.find((item) => item.productId === productId);
    if (!current || busy) return;
    const delta = Number(deltas[productId]);
    const reason = reasons[productId]?.trim() ?? '';
    if (!Number.isSafeInteger(delta) || delta === 0 || !reason) {
      setMessages((all) => ({ ...all, [productId]: { kind: 'error', text: '0以外の整数と調整理由を入力してください。' } }));
      return;
    }
    setBusy(productId);
    setMessages((all) => ({ ...all, [productId]: { kind: 'success', text: '' } }));
    try {
      const response = await fetch('/api/admin/inventory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, delta, reason, expectedVersion: current.version }),
      });
      const body = await response.json() as { data?: { state?: unknown; adjustmentId?: string; createdAt?: string; latest?: unknown }; error?: ErrorBody['error'] };
      if (!response.ok) {
        const latest = AdminInventoryStateSchema.safeParse(body.data?.latest);
        if (latest.success) setItems((all) => all.map((item) => item.productId === productId ? { ...item, ...latest.data } : item));
        throw new Error(body.error?.message ?? '在庫を更新できませんでした。');
      }
      const state = AdminInventoryStateSchema.parse(body.data?.state);
      setItems((all) => all.map((item) => item.productId === productId ? { ...item, ...state } : item));
      if (body.data?.adjustmentId && body.data.createdAt) setAdjustments((all) => [{
        id: body.data!.adjustmentId!, productId, productName: current.name, delta, reason, createdAt: body.data!.createdAt!,
      }, ...all].slice(0, 50));
      setDeltas((all) => ({ ...all, [productId]: '' }));
      setReasons((all) => ({ ...all, [productId]: '' }));
      setMessages((all) => ({ ...all, [productId]: { kind: 'success', text: '在庫を調整しました。' } }));
    } catch (error) {
      setMessages((all) => ({ ...all, [productId]: { kind: 'error', text: error instanceof Error ? error.message : '在庫を更新できませんでした。' } }));
    } finally { setBusy(null); }
  }

  return <main className={styles.page}>
    <h1>在庫調整</h1>
    <p className={styles.intro}>実在庫、決済中の引当、販売可能数を確認し、理由を記録して数量を調整します。</p>
    <section className={styles.items} aria-label="商品在庫">
      {items.map((item) => <article className={styles.item} key={item.productId}>
        <div className={styles.productHead}>
          <div><p className={styles.category}>{item.category} · {item.sku}</p><h2>{item.name}</h2></div>
          <span className={styles.status}>{item.status === 'published' ? '公開中' : item.status === 'draft' ? '下書き' : '非公開'}</span>
        </div>
        <dl className={styles.quantities}>
          <div><dt>実在庫</dt><dd>{item.onHand}</dd></div><div><dt>引当中</dt><dd>{item.allocated}</dd></div><div><dt>販売可能</dt><dd>{item.available}</dd></div>
        </dl>
        <p className={styles.version}>在庫版 {item.version}</p>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(item.productId); }}>
          <label>増減数<input inputMode="numeric" type="number" step="1" value={deltas[item.productId] ?? ''}
            onChange={(event) => setDeltas((all) => ({ ...all, [item.productId]: event.target.value }))} aria-label={`${item.name}の増減数`} /></label>
          <label>調整理由<input type="text" maxLength={500} value={reasons[item.productId] ?? ''}
            onChange={(event) => setReasons((all) => ({ ...all, [item.productId]: event.target.value }))} aria-label={`${item.name}の調整理由`} /></label>
          <button type="submit" disabled={busy !== null}>{busy === item.productId ? '更新中…' : '在庫を調整'}</button>
        </form>
        {messages[item.productId]?.text && <p className={messages[item.productId].kind === 'error' ? styles.error : styles.success}
          role={messages[item.productId].kind === 'error' ? 'alert' : 'status'}>{messages[item.productId].text}</p>}
      </article>)}
      {items.length === 0 && <p className={styles.empty}>対象商品はありません。</p>}
    </section>
    <nav className={styles.pager} aria-label="在庫一覧のページ">
      <button type="button" onClick={() => void loadPage(page - 1)} disabled={pageBusy || busy !== null || page <= 1}>前のページ</button>
      <span>{page} / {totalPages} ページ（{total} 商品）</span>
      <button type="button" onClick={() => void loadPage(page + 1)} disabled={pageBusy || busy !== null || page >= totalPages}>次のページ</button>
    </nav>
    {messages._page?.text && <p className={styles.error} role="alert">{messages._page.text}</p>}
    <section className={styles.history} aria-labelledby="inventory-history-heading">
      <h2 id="inventory-history-heading">最近の調整履歴</h2>
      {adjustments.length ? <ul>{adjustments.map((entry) => <li key={entry.id}>
        <strong>{entry.productName}</strong><span className={entry.delta > 0 ? styles.positive : styles.negative}>{entry.delta > 0 ? '+' : ''}{entry.delta}</span>
        <span>{entry.reason}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('ja-JP')}</time>
      </li>)}</ul> : <p className={styles.empty}>調整履歴はありません。</p>}
    </section>
  </main>;
}
