'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CheckoutQuoteResultSchema } from '@/lib/checkout-quote-schemas';
import styles from './page.module.css';

type ErrorEnvelope = { error?: { code?: string; message?: string }; requestId?: string };

export function CheckoutReview() {
  const rawQuote = useSyncExternalStore(
    (notify) => {
      const listener = () => notify();
      window.addEventListener('storage', listener);
      return () => window.removeEventListener('storage', listener);
    },
    () => window.sessionStorage.getItem('checkoutQuote') ?? '',
    () => '',
  );
  const quote = useMemo(() => {
    if (!rawQuote) return null;
    try { return CheckoutQuoteResultSchema.parse(JSON.parse(rawQuote)); } catch { return null; }
  }, [rawQuote]);
  const [now, setNow] = useState(() => Date.now());
  const expired = quote ? Date.parse(quote.expiresAt) <= now : false;
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function startCheckout() {
    if (!quote || expired || !confirmed || busy) return;
    setBusy(true); setMessage('');
    try {
      let idempotencyKey = window.sessionStorage.getItem('checkoutIdempotencyKey');
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        window.sessionStorage.setItem('checkoutIdempotencyKey', idempotencyKey);
      }
      const response = await fetch('/api/checkout/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ quoteId: quote.quoteId, userConfirmed: true }),
      });
      const body = await response.json() as { data?: { checkoutUrl?: string }; } & ErrorEnvelope;
      if (!response.ok || !body.data?.checkoutUrl) throw new Error(body.error?.message ?? '決済を開始できませんでした。見積を再確認してください。');
      window.location.assign(body.data.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '決済開始に失敗しました。');
    } finally { setBusy(false); }
  }

  if (!quote) return <main className={styles.page}><p className={styles.eyebrow}>S13 / ORDER REVIEW</p>
    <h1>注文内容の確認</h1><section className={styles.notice} role="status"><p>有効な見積がありません。住所を選び、正式見積を作成してください。</p><Link href="/checkout/address">配送先を選択する</Link></section></main>;

  const compatibilityWarnings = quote.compatibility.filter((finding) => finding.status === 'incompatible' || finding.status === 'unknown');
  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <nav aria-label="パンくず"><Link href="/checkout/address">配送先</Link> / 注文内容の確認</nav>
    <p className={styles.eyebrow}>S13 / ORDER REVIEW</p><h1>注文内容の確認</h1>
    {expired && <section className={styles.error} role="alert"><h2>見積の有効期限が切れました</h2><p>現在の価格・在庫・送料を再確認するため、見積を作り直してください。</p><Link href="/checkout/address">配送先から再見積する</Link></section>}
    {!expired && <p className={styles.expiry}>見積有効期限: <time dateTime={quote.expiresAt}>{new Date(quote.expiresAt).toLocaleString('ja-JP')}</time></p>}
    <div className={styles.layout}>
      <div className={styles.details}>
        <section><h2>お届け先</h2><address><strong>{quote.address.recipientName}</strong><br />〒{quote.address.postalCode}<br />{quote.address.prefectureCode} / {quote.address.city}{quote.address.street}<br />{quote.address.building}</address></section>
        <section><h2>商品と現在の価格</h2><ul className={styles.items}>{quote.items.map((item) => <li key={item.productId}>
          <div><strong>{item.name}</strong><span>{item.brand} / {item.sku}</span><span>数量 {item.quantity} ・ 在庫 {item.availableQuantity}</span></div>
          <div className={styles.money}>{item.unitPriceAtAddYen !== null && item.unitPriceAtAddYen !== item.unitPriceYen && <span>カート表示時 {item.unitPriceAtAddYen.toLocaleString('ja-JP')}円</span>}<span>{item.unitPriceYen.toLocaleString('ja-JP')}円 × {item.quantity}</span><strong>{item.lineTotalYen.toLocaleString('ja-JP')}円</strong></div>
        </li>)}</ul></section>
        {quote.priceChanges.length > 0 && <section className={styles.warning} aria-labelledby="price-change"><h2 id="price-change">カート表示後に価格が変わりました</h2><p>以下の商品は現在価格で再計算しています。新しい金額を確認してから続けてください。</p><ul>{quote.priceChanges.map((change) => <li key={change.productId}>{change.name}: {change.unitPriceAtAddYen.toLocaleString('ja-JP')}円 → {change.unitPriceYen.toLocaleString('ja-JP')}円</li>)}</ul></section>}
        {compatibilityWarnings.length > 0 && <section className={styles.warning} aria-labelledby="compat-warning"><h2 id="compat-warning">構成の互換性について</h2><p>互換性に不一致または判定できない項目があります。警告のみで、購入は妨げません。</p><ul>{compatibilityWarnings.map((finding) => <li key={finding.rule}><strong>{finding.status === 'incompatible' ? '不一致' : '判定できません'}</strong>: {finding.reason}{finding.matchingUrl && <> <Link href={finding.matchingUrl}>適合商品を確認</Link></>}</li>)}</ul></section>}
      </div>
      <aside className={styles.summary} aria-label="正式な金額">
        <h2>正式な金額</h2><dl>
          <div><dt>商品小計（税込）</dt><dd>{quote.goodsTotalYen.toLocaleString('ja-JP')}円</dd></div>
          <div><dt>通常送料</dt><dd>{quote.shipping.baseYen.toLocaleString('ja-JP')}円</dd></div>
          <div><dt>重量物送料</dt><dd>{quote.shipping.heavyYen.toLocaleString('ja-JP')}円</dd></div>
          <div><dt>送料合計</dt><dd>{quote.shipping.totalYen.toLocaleString('ja-JP')}円</dd></div>
          <div><dt>内税（10%）</dt><dd>{quote.taxTotalYen.toLocaleString('ja-JP')}円</dd></div>
          <div className={styles.total}><dt>お支払い合計</dt><dd>{quote.grandTotalYen.toLocaleString('ja-JP')}円</dd></div>
        </dl>
        <p>送料規則版: {quote.shippingSettingsVersion}</p>
        <p><a href={quote.shippingSourceUrl} target="_blank" rel="noreferrer">ヤマト運輸公式料金表</a>{quote.shippingSourceCheckedAt && <>（確認日 {new Date(quote.shippingSourceCheckedAt).toLocaleDateString('ja-JP')}）</>}</p>
        <p className={styles.note}>これはテスト環境の模擬購入です。実際の課金・発送はありません。</p>
        {message && <p className={styles.error} role="alert">{message}</p>}
        <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={expired} onChange={(event) => setConfirmed(event.target.checked)} /> 商品・配送先・正式な金額を確認しました。</label>
        <button className={styles.primary} type="button" disabled={!confirmed || expired || busy} onClick={startCheckout}>{busy ? '決済先を準備中…' : '内容を確認してテスト決済へ'}</button>
        <Link href="/checkout/address">配送先を変更して再見積する</Link>
      </aside>
    </div>
  </main>;
}
