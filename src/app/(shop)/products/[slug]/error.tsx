"use client";

import Link from "next/link";
import { Button } from "@/components/Button";
import { StatusMessage } from "@/components/StatusMessage";
import styles from "./page.module.css";

export default function ProductDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className={styles.main} id="main-content" tabIndex={-1}>
    <StatusMessage kind="error" title="商品情報を読み込めませんでした">
      <p>商品情報を取得できませんでした。時間をおいて再度お試しください。</p>
      <p><Button type="button" onClick={reset}>もう一度試す</Button> <Link href="/search">商品一覧へ戻る</Link></p>
    </StatusMessage>
  </main>;
}
