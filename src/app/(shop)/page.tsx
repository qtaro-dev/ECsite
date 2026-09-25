import Link from "next/link";
import styles from "./page.module.css";
import { StatusMessage } from "@/components/StatusMessage";

const uses = [
  { id: "gaming", title: "ゲームを楽しみたい", description: "グラフィック性能や冷却を重視して、遊びたいゲームに合うパーツを探せます。", icon: "01" },
  { id: "daily", title: "普段使いのPCを作りたい", description: "仕事や学習、日々の作業に使いやすいパーツを見つけましょう。", icon: "02" },
  { id: "editing", title: "動画編集をしたい", description: "編集作業を快適にするCPU、メモリ、ストレージなどを比較できます。", icon: "03" },
] as const;

const categories = [
  ["CPU", "cpu", "処理の中心となるパーツ"], ["グラフィックボード", "gpu", "映像処理を担当"],
  ["マザーボード", "motherboard", "パーツをつなぐ基板"], ["メモリ", "memory", "作業中のデータを一時保存"],
  ["SSD", "ssd", "データを保存するストレージ"], ["電源ユニット", "power-supply", "各パーツへ電力を供給"],
  ["PCケース", "pc-case", "パーツを収納するケース"], ["CPUクーラー", "cpu-cooler", "CPUの熱を冷却"],
] as const;

export default function HomePage() {
  return (
    <main className={styles.home} id="main-content" tabIndex={-1}>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>BUILD YOUR PC, STEP BY STEP</p>
          <h1 id="home-title">自分に合うパーツから、<br />PCづくりを始めよう。</h1>
          <p>用途からも、知りたい仕様からも。必要なパーツをひとつずつ探せます。</p>
          <form className={styles.heroSearch} action="/search" role="search">
            <label htmlFor="home-search">商品名・型番で検索</label>
            <div><input id="home-search" name="q" type="search" placeholder="例：Ryzen、GeForce、DDR5" maxLength={100} />
              <button type="submit">商品を検索</button></div>
          </form>
        </div>
        <div className={styles.heroArt} aria-hidden="true"><span className={styles.orbit} /><span className={styles.chip}>PC<br />PARTS</span><span className={styles.artLabel}>YOUR NEXT<br />BUILD STARTS HERE</span></div>
      </section>

      <section className={styles.section} aria-labelledby="use-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>START WITH YOUR PURPOSE</p><h2 id="use-title">何をしたいかから探す</h2></div><p>パーツに詳しくなくても大丈夫。使い方に合う商品を見つけましょう。</p></div>
        <div className={styles.useGrid}>{uses.map((item) => <Link className={styles.useCard} href={`/search?usage=${item.id}`} key={item.id}>
          <span className={styles.cardNumber}>{item.icon}</span><span className={styles.arrow} aria-hidden="true">↗</span>
          <h3>{item.title}</h3><p>{item.description}</p><span className={styles.textLink}>この用途で探す <span aria-hidden="true">→</span></span>
        </Link>)}</div>
      </section>

      <section className={styles.categorySection} aria-labelledby="category-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>BROWSE COMPONENTS</p><h2 id="category-title">パーツから探す</h2></div><Link href="/search">すべての商品を見る <span aria-hidden="true">→</span></Link></div>
        <div className={styles.categoryGrid}>{categories.map(([name, slug, description], index) => <Link className={styles.categoryCard} href={`/categories/${slug}`} key={slug}>
          <span className={styles.categoryIndex}>{String(index + 1).padStart(2, "0")}</span><span><strong>{name}</strong><small>{description}</small></span><span className={styles.arrow} aria-hidden="true">↗</span>
        </Link>)}</div>
      </section>

      <div className={styles.demo}><StatusMessage kind="warning" title="公開デモについて"><p>このサイトは購入体験を試すためのデモです。実際の商品販売・課金・発送は行いません。</p></StatusMessage></div>
    </main>
  );
}
