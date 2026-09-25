import Link from 'next/link';
import styles from './forbidden.module.css';

export default function Forbidden() {
  return (
    <main className={styles.main}>
      <h1>管理画面を利用できません</h1>
      <p>管理者権限が必要です。ログイン状態を確認するか、運用担当者へお問い合わせください。</p>
      <Link className={styles.link} href="/login?next=%2Fadmin">ログイン画面へ</Link>
    </main>
  );
}
