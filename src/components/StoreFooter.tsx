import Link from "next/link";
import styles from "./StoreFooter.module.css";

export function StoreFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.notice}><strong>公開デモ</strong><span>実際の商品販売・課金・発送は行いません。</span></p>
        <nav className={styles.links} aria-label="フッター">
          <Link href="/privacy">プライバシーについて</Link>
          <a href="https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html" target="_blank" rel="noreferrer">ヤマト運輸 料金表（公式・別タブで開く）</a>
          <span>お問い合わせ先は準備中です。</span>
        </nav>
        <small>自作PCパーツECサイト デモ</small>
      </div>
    </footer>
  );
}
