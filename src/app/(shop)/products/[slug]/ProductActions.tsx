"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./ProductActions.module.css";

export function ProductActions({ productId, slug, availableQuantity, category }: {
  productId: string; slug: string; availableQuantity: number; category: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const soldOut = availableQuantity < 1;
  const maxQuantity = Math.min(10, Math.max(1, availableQuantity));
  const cartHref = `/cart?productId=${encodeURIComponent(productId)}&quantity=${quantity}`;
  const buildHref = `/build?category=${encodeURIComponent(category)}&product=${encodeURIComponent(slug)}`;
  const isPrebuilt = category === "prebuilt-pc";

  return <section className={styles.actions} aria-labelledby="purchase-title">
    <h2 id="purchase-title">{isPrebuilt ? "完成PCを購入" : "購入・構成"}</h2>
    <p className={soldOut ? styles.soldOut : styles.available} role="status">
      {soldOut ? "在庫切れ" : `販売可能：${availableQuantity.toLocaleString("ja-JP")}点`}
    </p>
    <label htmlFor="product-quantity">数量</label>
    <input id="product-quantity" type="number" min={1} max={maxQuantity} value={quantity}
      disabled={soldOut} onChange={(event) => setQuantity(Math.min(maxQuantity, Math.max(1, Number(event.target.value) || 1)))} />
    {soldOut
      ? <span className={styles.disabledLink} aria-disabled="true">{isPrebuilt ? "在庫切れのためカートに入れられません" : "カートへ進む（在庫切れ）"}</span>
      : <Link className={styles.primaryAction} href={cartHref}>{isPrebuilt ? "この完成PCをカートに入れる" : "カートへ進む"}</Link>}
    {!isPrebuilt && <Link className={styles.secondaryAction} href={buildHref}>構成に追加</Link>}
    <p className={styles.note}>{isPrebuilt
      ? "完成PC全体を1つの商品としてカートに入れます。"
      : "カートの価格・在庫は購入手続き開始時にも再確認されます。構成の選択はURLまたはブラウザ内の一時状態です。"}</p>
  </section>;
}
