'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './admin.module.css';

const navigation = [
  ['/admin', 'ダッシュボード'],
  ['/admin/products', '商品'],
  ['/admin/inventory', '在庫'],
  ['/admin/orders', '注文'],
  ['/admin/settings/shipping', '送料設定'],
  ['/admin/settings/email', 'メール設定'],
] as const;

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="管理メニュー">
      {navigation.map(([href, label]) => <Link
        key={href}
        href={href}
        aria-current={pathname === href ? 'page' : undefined}
        className={pathname === href ? styles.active : undefined}
      >{label}</Link>)}
    </nav>
  );
}
