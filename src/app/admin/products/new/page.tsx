import { AdminProductEditor } from '../ProductEditor';
import styles from '../products.module.css';

export default function NewAdminProductPage() {
  return <main className={styles.main}><div className={styles.heading}><div><h1>新規商品</h1><p>必須仕様が揃うまでは下書きとして入力できます。</p></div></div><AdminProductEditor /></main>;
}
