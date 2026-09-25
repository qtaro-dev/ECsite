"use client";

import { useState } from "react";
import styles from "./page.module.css";

export function ProductImage({ src, alt, productName }: { src: string; alt: string; productName: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className={styles.imageFailure} role="img" aria-label={`${productName}の商品画像を読み込めませんでした`}>
      <strong>商品画像を表示できません</strong>
      <span>画像の配信に失敗しました。商品名・型番・仕様をご確認ください。</span>
    </div>;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setFailed(true)} />;
}
