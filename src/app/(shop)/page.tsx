import styles from "./page.module.css";

export default function HomePage() {
  return (
    <main className={styles.main}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>PORTFOLIO PROJECT</p>
        <h1>自作PCパーツECサイト</h1>
        <p>購入体験を再現するWebショップを準備しています。</p>
        <p className={styles.notice}>実際の商品販売・課金・発送は行いません。</p>
      </div>
    </main>
  );
}
