import Link from 'next/link';
import styles from './forbidden.module.css';

export default function Forbidden() {
  return (
    <main className={styles.main}>
      <h1>管理画面を利用できません</h1>
      <p>管理者権限が必要です。管理者アカウントでログインしてください。</p>
      <Link className={styles.link} href="/admin-login">管理者ログインへ</Link>
    </main>
  );
}
