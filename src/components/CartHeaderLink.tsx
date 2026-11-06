"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { CartProjection } from "@/lib/schemas";
import { cartChangedEvent } from "@/features/cart/cart-events";
import styles from "./StoreHeader.module.css";

export function CartHeaderLink() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let pending: AbortController | undefined;
    const refresh = async () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await fetch("/api/cart?peek=1", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Cart unavailable");
        const { data } = await response.json() as { data?: CartProjection };
        if (!Array.isArray(data?.items) || !data.items.every((item) => Number.isSafeInteger(item?.quantity) && item.quantity > 0)) throw new Error("Invalid cart");
        if (!controller.signal.aborted) setCount(data.items.reduce((total, item) => total + item.quantity, 0));
      } catch {
        if (!controller.signal.aborted) setCount(0);
      }
    };

    void refresh();
    const onCartChanged = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.ownerChanged) setCount(0);
      void refresh();
    };
    window.addEventListener(cartChangedEvent, onCartChanged);
    window.addEventListener("focus", refresh);
    return () => {
      pending?.abort();
      window.removeEventListener(cartChangedEvent, onCartChanged);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname]);

  return <Link href="/cart" className={styles.cartLink} aria-label={count > 0 ? `カート（商品${count}点）` : undefined}>
    カート
    {count > 0 && <span className={styles.cartBadge} aria-hidden="true">{count > 9 ? "9+" : count}</span>}
  </Link>;
}
