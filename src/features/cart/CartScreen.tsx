'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { StatusMessage } from '@/components/StatusMessage';
import { CartLineSchema, CartProjectionSchema } from '@/lib/schemas';
import { productImageUrl } from '@/lib/product-image-url';
import styles from './CartScreen.module.css';

const CartDisplayLineSchema = CartLineSchema.extend({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  brand: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  imagePath: z.string().min(1).nullable().optional(),
  unitPriceAtAddYen: z.number().int().safe().nonnegative().nullable().optional(),
  availabilityState: z.enum(['available', 'sold_out', 'unavailable']).optional(),
});
const CartScreenProjectionSchema = CartProjectionSchema.extend({ items: z.array(CartDisplayLineSchema) });
type CartDisplayLine = z.infer<typeof CartDisplayLineSchema>;
type CartScreenProjection = z.infer<typeof CartScreenProjectionSchema>;
type InitialProduct = { productId: string; quantity: number } | null;
type ApiError = { error?: { code?: string; message?: string; currentCart?: unknown } };

function parseCart(value: unknown): CartScreenProjection {
  return CartScreenProjectionSchema.parse(value);
}

function yen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

function itemName(item: CartDisplayLine): string {
  return item.name ?? `商品 ${item.productId.slice(0, 8)}`;
}

function failureMessage(status: number, code?: string): string {
  if (status === 409 || code === 'CONFLICT') return '販売可能数が更新されました。該当商品の数量を確認してください。';
  if (status === 404 || code === 'NOT_FOUND') return '商品が販売終了、または現在カートに追加できません。商品一覧から別の商品をお選びください。';
  if (status === 400 || code === 'BAD_REQUEST') return 'カートの操作内容を確認できませんでした。ページを再読み込みしてください。';
  return 'カートに接続できませんでした。通信状態を確認して再試行してください。';
}

export function CartScreen({ isMember, initialProduct }: { isMember: boolean; initialProduct: InitialProduct }) {
  const [cart, setCart] = useState<CartScreenProjection | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [lineMessages, setLineMessages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const handledInitialProduct = useRef(false);

  const loadCart = useCallback(async () => {
    const response = await fetch('/api/cart', { cache: 'no-store' });
    const payload = await response.json() as { data?: unknown; error?: { code?: string } };
    if (!response.ok || payload.data === undefined) throw new Error(failureMessage(response.status, payload.error?.code));
    return parseCart(payload.data);
  }, []);

  const refresh = useCallback(async () => {
    setPageError('');
    try { setCart(await loadCart()); }
    catch (error) { setPageError(error instanceof Error ? error.message : 'カートを読み込めませんでした。'); }
  }, [loadCart]);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      setLoading(true);
      setPageError('');
      try {
        const initialCart = await loadCart();
        if (cancelled) return;
        setCart(initialCart);
        if (initialProduct && !handledInitialProduct.current) {
          handledInitialProduct.current = true;
          setBusyProductId(initialProduct.productId);
          const response = await fetch('/api/cart', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(initialProduct),
          });
          const payload = await response.json() as { data?: unknown } & ApiError;
          if (cancelled) return;
          if (response.ok && payload.data !== undefined) {
            setCart(parseCart(payload.data));
            setNotice('商品をカートに追加しました。現在の価格と販売可能数を確認してください。');
          } else {
            const conflictCart = payload.error?.currentCart;
            if (conflictCart !== undefined) setCart(parseCart(conflictCart));
            setPageError(failureMessage(response.status, payload.error?.code));
            setLineMessages((current) => ({ ...current, [initialProduct.productId]: failureMessage(response.status, payload.error?.code) }));
          }
        }
      } catch (error) {
        if (!cancelled) setPageError(error instanceof Error ? error.message : 'カートを読み込めませんでした。');
      } finally {
        if (!cancelled) { setLoading(false); setBusyProductId(null); }
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [initialProduct, loadCart]);

  async function updateQuantity(item: CartDisplayLine) {
    const quantity = drafts[item.productId] ?? item.quantity;
    setBusyProductId(item.productId);
    setLineMessages((current) => ({ ...current, [item.productId]: '' }));
    try {
      const response = await fetch('/api/cart', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: item.productId, quantity }),
      });
      const payload = await response.json() as { data?: unknown } & ApiError;
      if (response.ok && payload.data !== undefined) {
        setCart(parseCart(payload.data));
        setDrafts((current) => { const next = { ...current }; delete next[item.productId]; return next; });
        setNotice('カートを更新しました。表示価格は最新の税込価格です。');
      } else {
        const conflictCart = payload.error?.currentCart;
        if (conflictCart !== undefined) setCart(parseCart(conflictCart));
        setLineMessages((current) => ({ ...current, [item.productId]: failureMessage(response.status, payload.error?.code) }));
      }
    } catch {
      setLineMessages((current) => ({ ...current, [item.productId]: '通信できませんでした。入力数量を保持しています。再試行してください。' }));
    } finally { setBusyProductId(null); }
  }

  async function removeItem(item: CartDisplayLine) {
    setBusyProductId(item.productId);
    setLineMessages((current) => ({ ...current, [item.productId]: '' }));
    try {
      const response = await fetch(`/api/cart?productId=${encodeURIComponent(item.productId)}`, { method: 'DELETE' });
      const payload = await response.json() as { data?: unknown } & ApiError;
      if (response.ok && payload.data !== undefined) {
        setCart(parseCart(payload.data));
        setDrafts((current) => { const next = { ...current }; delete next[item.productId]; return next; });
        setNotice(`${itemName(item)}をカートから削除しました。`);
      } else setLineMessages((current) => ({ ...current, [item.productId]: failureMessage(response.status, payload.error?.code) }));
    } catch {
      setLineMessages((current) => ({ ...current, [item.productId]: '通信できませんでした。商品はカートに残っています。再試行してください。' }));
    } finally { setBusyProductId(null); }
  }

  const isEmpty = !loading && !pageError && cart?.items.length === 0;
  const checkoutBlocked = !cart || cart.items.some((item) => item.availabilityState === 'unavailable' || item.availabilityState === 'sold_out' || item.quantity > item.availableQuantity);
  const checkoutHref = isMember ? '/checkout/address' : '/login?next=%2Fcheckout%2Faddress';

  return <main className={styles.page} id="main-content" tabIndex={-1}>
    <nav className={styles.breadcrumb} aria-label="パンくずリスト"><Link href="/">トップ</Link><span aria-hidden="true">/</span><span aria-current="page">カート</span></nav>
    <header className={styles.header}><p className={styles.eyebrow}>YOUR CART</p><h1>カート</h1><p>カートには現在の税込価格と販売可能数が表示されます。商品価格・在庫は購入手続き開始時にも再確認されます。</p></header>

    {notice && <StatusMessage kind="success" title="カートを更新しました"><p>{notice}</p></StatusMessage>}
    {pageError && <StatusMessage kind="error" title="カートを更新できませんでした"><p>{pageError}</p><Button variant="secondary" type="button" onClick={() => void refresh()}>カートを再読み込み</Button></StatusMessage>}

    {loading && <section className={styles.loading} aria-label="カートを読み込み中" aria-busy="true"><span /><span /><span /></section>}
    {isEmpty && <section className={styles.empty} aria-labelledby="empty-cart-heading"><h2 id="empty-cart-heading">カートは空です</h2><p>商品を探して、気になるパーツをカートに追加してください。</p><div className={styles.emptyLinks}><Link href="/search">商品を検索する</Link><Link href="/">トップページへ戻る</Link></div></section>}

    {cart && cart.items.length > 0 && <div className={styles.cartLayout}>
      <section className={styles.items} aria-labelledby="cart-items-heading"><h2 id="cart-items-heading">カートの商品（{cart.items.length}点）</h2>
        {cart.items.map((item) => {
          const draft = drafts[item.productId] ?? item.quantity;
          const available = item.availabilityState === 'unavailable' || item.availabilityState === 'sold_out' || item.availableQuantity === 0;
          const overAvailable = item.quantity > item.availableQuantity;
          const name = itemName(item);
          const hasPriceChanged = item.unitPriceAtAddYen !== undefined && item.unitPriceAtAddYen !== null && item.unitPriceAtAddYen !== item.unitPriceYen;
          return <article className={styles.line} key={item.productId} aria-labelledby={`cart-item-${item.productId}`}>
            {item.imagePath && <Link href={item.slug ? `/products/${item.slug}` : '/search'} aria-label={`${name}の商品詳細`} className={styles.imageLink}><Image src={productImageUrl(item.imagePath)} alt="" width={112} height={84} unoptimized /></Link>}
            <div className={styles.itemMain}>
              <h3 id={`cart-item-${item.productId}`}>{item.slug ? <Link href={`/products/${item.slug}`}>{name}</Link> : name}</h3>
              {item.brand && item.sku && <p className={styles.itemSub}>{item.brand} / {item.sku}</p>}
              {available ? <p className={styles.soldOut} role="status">{item.availabilityState === 'unavailable' ? '販売終了' : '在庫切れ'}</p>
                : <p className={styles.stock}>販売可能数：{item.availableQuantity.toLocaleString('ja-JP')}点</p>}
              {overAvailable && <StatusMessage kind="warning" title="数量を確認してください"><p>カート数量は{item.quantity}点ですが、現在の販売可能数は{item.availableQuantity}点です。数量を変更してください。</p></StatusMessage>}
              {hasPriceChanged && <StatusMessage kind="warning" title="価格が変更されました"><p>追加時 {yen(item.unitPriceAtAddYen!)} → 現在 {yen(item.unitPriceYen)}。合計には現在価格を使用しています。</p></StatusMessage>}
              {item.unitPriceAtAddYen === null && <p className={styles.muted}>追加時の価格と比較できません。現在価格をご確認ください。</p>}
              <div className={styles.priceRow}><span>税込単価</span><strong>{yen(item.unitPriceYen)}</strong>{hasPriceChanged && <span className={styles.priceChanged}>変更あり</span>}</div>
              <div className={styles.lineTotal}><span>行小計</span><strong>{yen(item.lineTotalYen)}</strong></div>
              {lineMessages[item.productId] && <p className={styles.rowError} role="alert">{lineMessages[item.productId]}</p>}
              <div className={styles.rowActions}>
                <label htmlFor={`quantity-${item.productId}`}>数量（1〜10）</label>
                <input id={`quantity-${item.productId}`} type="number" min={1} max={10} value={draft}
                  onChange={(event) => setDrafts((current) => ({ ...current, [item.productId]: Math.max(1, Math.min(10, Number(event.target.value) || 1)) }))} />
                {(draft !== item.quantity || overAvailable) && <Button type="button" disabled={busyProductId !== null} onClick={() => void updateQuantity(item)}>{busyProductId === item.productId ? '更新中…' : '数量を更新'}</Button>}
                <Button variant="secondary" type="button" disabled={busyProductId !== null} onClick={() => void removeItem(item)}>{busyProductId === item.productId ? '処理中…' : '削除'}</Button>
              </div>
            </div>
          </article>;
        })}
      </section>

      <aside className={styles.summary} aria-labelledby="cart-summary-heading"><h2 id="cart-summary-heading">お支払い見込み</h2>
        <dl><div><dt>商品小計（税込）</dt><dd>{yen(cart.goodsTotalYen)}</dd></div>
          <div><dt>送料（概算）</dt><dd>{cart.estimatedShippingYen === null ? '未確定' : yen(cart.estimatedShippingYen)}</dd></div>
          {cart.estimatedShippingYen !== null && <div className={styles.grandTotal}><dt>税込合計見込み</dt><dd>{yen(cart.goodsTotalYen + cart.estimatedShippingYen)}</dd></div>}
        </dl>
        {cart.estimatedShippingYen === null
          ? <StatusMessage kind="warning" title="送料概算を表示できません"><p>配送先や商品の梱包条件が確定していないため、送料を算出できません。購入手続きで配送先と条件を確認した後、正式見積を表示します。</p></StatusMessage>
          : <p className={styles.estimateNote}>送料は配送先確定前の概算です。購入手続きでは配送先・梱包条件を確認して正式額を再計算します。</p>}
        <p><a href="https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html" target="_blank" rel="noreferrer">送料の算定根拠（ヤマト運輸）<span className={styles.visuallyHidden}>（新しいタブで開きます）</span></a></p>
        {checkoutBlocked && <p className={styles.checkoutBlocked}>在庫がない商品、販売終了の商品、または販売可能数を超える商品があります。数量を調整するか、該当商品を削除してください。</p>}
        <Link className={styles.checkoutButton} aria-disabled={checkoutBlocked} href={checkoutBlocked ? '#cart-items-heading' : checkoutHref}>{isMember ? '購入手続きへ' : 'ログインして購入手続きへ'}</Link>
        {!isMember && <p className={styles.registerLink}>会員登録がお済みでない方は <Link href="/register?next=%2Fcheckout%2Faddress">新規登録</Link></p>}
        <Link className={styles.continueShopping} href="/search">買い物を続ける</Link>
      </aside>
    </div>}
  </main>;
}