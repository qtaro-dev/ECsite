import Link from 'next/link';
import styles from '../../products/products.module.css';
import PrebuiltPcEditor from '../PrebuiltPcEditor';

export const dynamic = 'force-dynamic';

export default function NewPrebuiltPcPage() {
  return <main className={styles.main}>
    <div className={styles.heading}><div><h1>構成済みPCを登録</h1><p>構成や商品情報が揃うまでは下書きとして保存できます。</p></div><Link href="/admin/products" className={styles.primary}>商品一覧</Link></div>
    <PrebuiltPcEditor />
  </main>;
}
