import Link from "next/link";
import styles from "./StoreHeader.module.css";

const categories = [
  ["CPU", "cpu"], ["GPU", "gpu"], ["マザーボード", "motherboard"],
  ["メモリ", "memory"], ["SSD", "ssd"], ["電源", "power-supply"],
  ["PCケース", "pc-case"], ["CPUクーラー", "cpu-cooler"],
] as const;

export function StoreHeader() {
  return (
    <header className={styles.header}>
      <a className={styles.skipLink} href="#main-content">本文へ移動</a>
      <div className={styles.inner}>
        <div className={styles.topRow}>
          <Link className={styles.brand} href="/" aria-label="自作PCパーツECサイト トップ">
            <span className={styles.brandMark} aria-hidden="true">PC</span>
            <span>PCパーツ</span>
          </Link>
          <form className={styles.search} action="/search" role="search">
            <label className={styles.visuallyHidden} htmlFor="site-search">商品を検索</label>
            <input id="site-search" name="q" type="search" placeholder="商品名・型番で検索" />
            <button type="submit">検索</button>
          </form>
          <nav className={styles.utilityNav} aria-label="会員・カート">
            <Link href="/cart">カート</Link>
            <Link href="/account" aria-label="会員メニュー">会員</Link>
          </nav>
        </div>
        <nav className={styles.categoryNav} aria-label="商品カテゴリ・用途・構成">
          <Link href="/search?usage=gaming">ゲーム向け</Link>
          <Link href="/search?usage=daily">普段使い</Link>
          <Link href="/search?usage=editing">動画編集</Link>
          {categories.map(([label, slug]) => <Link key={slug} href={`/categories/${slug}`}>{label}</Link>)}
          <Link href="/build">構成を確認</Link>
        </nav>
      </div>
    </header>
  );
}
