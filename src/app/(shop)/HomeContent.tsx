import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./page.module.css";
import { StatusMessage } from "@/components/StatusMessage";
import { categoryImageDirectory, categoryImageFiles, storageCategory } from "@/lib/category-images";

const uses = [
  { id: "gaming", title: "ゲーミングPC", description: "ゲーム向けにショップが構成した完成PCを比較できます。", icon: "01", image: { src: "/images/home-purpose/gaming_pc.png", width: 720, height: 405, alt: "ゲーム画面とコントローラーが並ぶPC" } },
  { id: "daily", title: "一般用途向けPC", description: "仕事や学習、日々の作業に使いやすい完成PCを探せます。", icon: "02", image: { src: "/images/home-purpose/office_pc.png", width: 720, height: 405, alt: "棒グラフを表示したデスクトップPC" } },
  { id: "editing", title: "クリエイターPC", description: "動画編集などの制作作業向けに構成した完成PCを比較できます。", icon: "03", image: { src: "/images/home-purpose/create_pc.png", width: 720, height: 405, alt: "動画編集画面と鍵盤、タブレットが並ぶPC" } },
] as const;

const useImageSizes = "(max-width: 767px) calc(100vw - 3.375rem), (max-width: 1312px) calc(33.33vw - 4.375rem), 366px";

const categories = [
  { name: "CPU", slug: "cpu", description: "処理の中心となるパーツ" },
  { name: "グラフィックボード", slug: "gpu", description: "映像処理を担当" },
  { name: "マザーボード", slug: "motherboard", description: "パーツをつなぐ基板" },
  { name: "メモリ", slug: "memory", description: "作業中のデータを一時保存" },
  { name: "SSD", slug: "ssd", description: "データを保存するストレージ" },
  { name: "電源ユニット", slug: "power-supply", description: "各パーツへ電力を供給" },
  { name: "PCケース", slug: "pc-case", description: "パーツを収納するケース" },
  { name: "CPUクーラー", slug: "cpu-cooler", description: "CPUの熱を冷却" },
] as const;

const categoryImageSizes = "(max-width: 457px) max(44px, 14vw), (max-width: 767px) 64px, 80px";

type HomeContentProps = {
  heroArt?: ReactNode;
  heroClassName?: string;
  previewNavigation?: ReactNode;
  hideHeroEyebrow?: boolean;
  showCardImages?: boolean;
};

export function HomeContent({ heroArt, heroClassName, previewNavigation, hideHeroEyebrow = false, showCardImages = false }: HomeContentProps) {
  const demoNotice = (
    <StatusMessage kind="warning" title="公開デモについて">
      <p>このサイトは購入体験を試すためのデモです。実際の商品販売・課金・発送は行いません。</p>
    </StatusMessage>
  );

  return (
    <main className={styles.home} id="main-content" tabIndex={-1}>
      {previewNavigation}
      {!previewNavigation && <div className={`${styles.demo} ${styles.demoAboveHero}`}>{demoNotice}</div>}
      <section className={heroClassName ? `${styles.hero} ${heroClassName}` : styles.hero} aria-labelledby="home-title">
        <div className={styles.heroCopy}>
          {!hideHeroEyebrow && <p className={styles.eyebrow}>BUILD YOUR PC, STEP BY STEP</p>}
          <h1 id="home-title">自分に合うパーツから、<br />PCづくりを始めよう。</h1>
          <p>用途からも、知りたい仕様からも。必要なパーツをひとつずつ探せます。</p>
          <form className={styles.heroSearch} action="/search" role="search" aria-label="トップページから商品を検索">
            <label htmlFor="home-search">商品名・型番で検索</label>
            <div><input id="home-search" name="q" type="search" placeholder="例：Ryzen、GeForce、DDR5" maxLength={100} />
              <button type="submit">商品を検索</button></div>
          </form>
        </div>
        {heroArt ?? <div className={styles.heroArt} aria-hidden="true"><span className={styles.orbit} /><span className={styles.chip}>PC<br />PARTS</span><span className={styles.artLabel}>YOUR NEXT<br />BUILD STARTS HERE</span></div>}
      </section>

      <section className={styles.section} aria-labelledby="use-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>START WITH YOUR PURPOSE</p><h2 id="use-title">用途別から探す</h2></div><p>パーツに詳しくなくても大丈夫。使い方に合う商品を見つけましょう。</p></div>
        <div className={styles.useGrid}>{uses.map((item) => <Link className={showCardImages ? `${styles.useCard} ${styles.useCardWithImage}` : styles.useCard} href={`/prebuilt-pc/${item.id}`} key={item.id}>
          {!showCardImages && <span className={styles.cardNumber}>{item.icon}</span>}<span className={styles.arrow} aria-hidden="true">↗</span>
          <h3>{item.title}</h3>
          {showCardImages && (
            <span className={styles.useImage}>
              <Image src={item.image.src} width={item.image.width} height={item.image.height} alt={item.image.alt} sizes={useImageSizes} loading="lazy" />
            </span>
          )}
          <p>{item.description}</p>{!showCardImages && <span className={styles.textLink}>完成PCを見る <span aria-hidden="true">→</span></span>}
        </Link>)}</div>
      </section>

      <section className={styles.categorySection} aria-labelledby="category-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>BROWSE COMPONENTS</p><h2 id="category-title">パーツ一覧</h2></div><Link href="/search">すべての商品を見る <span aria-hidden="true">→</span></Link></div>
        <div className={styles.categoryGrid}>
          {categories.map((item, index) => (
            <Link className={showCardImages ? `${styles.categoryCard} ${styles.categoryCardWithImage}` : styles.categoryCard} href={showCardImages && item.slug === "ssd" ? storageCategory.href : `/categories/${item.slug}`} key={item.slug}>
              {showCardImages ? (
                <span className={styles.categoryImage}>
                  <Image src={`${categoryImageDirectory}/${categoryImageFiles[item.slug]}`} alt="" fill sizes={categoryImageSizes} />
                </span>
              ) : <span className={styles.categoryIndex}>{String(index + 1).padStart(2, "0")}</span>}
              <span className={styles.categoryCopy}>
                <strong>{showCardImages && item.slug === "ssd" ? storageCategory.name : item.name}</strong>
                <small>{item.description}</small>
              </span>
              {!showCardImages && <span className={styles.arrow} aria-hidden="true">↗</span>}
            </Link>
          ))}
        </div>
      </section>

      {previewNavigation && <div className={styles.demo}>{demoNotice}</div>}
    </main>
  );
}
