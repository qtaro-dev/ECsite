import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { AdminOverviewSchema } from '@/lib/admin-schemas';
import { createAdminDataClient, getAdminOverview } from '@/server/admin/overview';
import styles from './admin.module.css';

export const dynamic = 'force-dynamic';

const cards = [
  ['publishedProducts', '公開商品', '/admin/products'],
  ['outOfStockProducts', '在庫不足', '/admin/inventory'],
  ['orders', '注文', '/admin/orders'],
  ['notificationFailures', '通知障害', '/admin/settings/email'],
] as const;

export default async function AdminDashboardPage() {
  const auditId = randomUUID();
  let counts;
  try {
    counts = await getAdminOverview(createAdminDataClient());
  } catch {
    throw new Error(`管理ダッシュボードを読み込めませんでした。時間をおいて再度お試しください。 (監査ID: ${auditId})`);
  }
  const overview = AdminOverviewSchema.parse({ ...counts, auditId });
  return (
    <main className={styles.dashboard}>
      <h1>A01 管理ダッシュボード</h1>
      <p className={styles.intro}>運用状況を確認し、各管理画面へ移動できます。</p>
      <section className={styles.cards} aria-label="運用状況">
        {cards.map(([key, label, href]) => <Link className={styles.card} href={href} key={key}>
          <h2>{label}</h2>
          <span className={styles.count}>{overview[key]}</span>
          {overview[key] === 0 && <span className={styles.empty}>対象なし</span>}
        </Link>)}
      </section>
      <p className={styles.audit}>監査ID: <code>{overview.auditId}</code></p>
    </main>
  );
}
