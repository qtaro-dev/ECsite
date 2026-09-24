import styles from "./page.module.css";
import { StatusMessage } from "@/components/StatusMessage";

export default function HomePage() {
  return (
    <main className={styles.main} id="main-content" tabIndex={-1}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>PORTFOLIO PROJECT</p>
        <h1>自作PCパーツECサイト</h1>
        <p>購入体験を再現するWebショップを準備しています。</p>
        <StatusMessage kind="warning" title="公開デモ">
          <p>実際の商品販売・課金・発送は行いません。</p>
        </StatusMessage>
      </div>
    </main>
  );
}
