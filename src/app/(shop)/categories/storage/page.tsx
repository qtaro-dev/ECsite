import Image from "next/image";
import Link from "next/link";
import { categoryIllustrationLabel, categoryImage, storageCategory } from "@/lib/category-images";
import styles from "@/features/catalog/CatalogExplorer.module.css";

export default function StorageCategoryPage() {
  return (
    <main className={styles.main} id="main-content" tabIndex={-1}>
      <nav className={styles.breadcrumb} aria-label="パンくずリスト">
        <Link href="/">トップ</Link><span aria-hidden="true">/</span>
        <span aria-current="page">{storageCategory.name}</span>
      </nav>
      <header className={styles.pageHeader}>
        <h1>{storageCategory.name}</h1>
        <p>用途に合わせてSSDまたはHDDを選べます。</p>
      </header>
      <div className={styles.storageGrid}>
        {storageCategory.parts.map(({ category, name, description }) => (
          <Link key={category} className={styles.storageCard} href={`/categories/${category}`}>
            <div className={styles.storageArt} aria-hidden="true">
              <Image src={categoryImage(category)} alt="" width={144} height={112} />
              <span>{name}</span>
            </div>
            <h2>{name}</h2>
            <p>{description}</p>
            <small>{categoryIllustrationLabel}</small>
          </Link>
        ))}
      </div>
    </main>
  );
}
