"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { StatusMessage } from "@/components/StatusMessage";
import { notifyCartChanged } from "@/features/cart/cart-events";
import { cartAddMessages, cartFailureMessage } from "@/features/cart/cart-messages";
import styles from "./ProductActions.module.css";

export function ProductActions({ productId, availableQuantity, category }: {
  productId: string; availableQuantity: number; category: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const submitting = useRef(false);
  const soldOut = availableQuantity < 1;
  const maxQuantity = Math.min(10, Math.max(1, availableQuantity));
  const isPrebuilt = category === "prebuilt-pc";

  async function addToCart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (soldOut || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/cart", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity }),
      });
      if (response.ok) {
        notifyCartChanged();
        setMessage({ kind: "success", text: cartAddMessages.success });
      } else {
        setMessage({ kind: "error", text: cartFailureMessage(response.status) });
      }
    } catch {
      setMessage({ kind: "error", text: cartFailureMessage(503) });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <section className={styles.actions} aria-labelledby="purchase-title">
    <h2 id="purchase-title">{isPrebuilt ? "完成PCを購入" : "購入"}</h2>
    <p id="product-stock-status" className={soldOut ? styles.soldOut : styles.available} role="status">
      {soldOut ? "在庫切れ" : `販売可能：${availableQuantity.toLocaleString("ja-JP")}点`}
    </p>
    <form className={styles.purchaseForm} onSubmit={addToCart} aria-busy={busy}>
      <label htmlFor="product-quantity">数量</label>
      <input id="product-quantity" type="number" min={1} max={maxQuantity} value={quantity}
        disabled={soldOut || busy} onChange={(event) => setQuantity(Math.min(maxQuantity, Math.max(1, Number(event.target.value) || 1)))} />
      <Button className={styles.primaryAction} type="submit" disabled={soldOut || busy} aria-describedby={soldOut ? "product-stock-status" : undefined}>
        {busy ? cartAddMessages.pending : cartAddMessages.label}
      </Button>
    </form>
    {message && <StatusMessage kind={message.kind}><p>{message.text}</p></StatusMessage>}
    <p className={styles.note}>{isPrebuilt
      ? "完成PC全体を1つの商品としてカートに入れます。"
      : "カートの価格・在庫は購入手続き開始時にも再確認されます。"}</p>
  </section>;
}
