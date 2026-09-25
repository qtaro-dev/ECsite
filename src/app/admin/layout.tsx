import type { ReactNode } from 'react';
import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { requireAdminAccess } from '@/server/admin/authorization';
import { AdminNavigation } from './AdminNavigation';
import styles from './admin.module.css';

export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const access = await requireAdminAccess();
  if (access.kind === 'denied') {
    if (access.status === 401 || access.status === 403) forbidden();
    throw new Error('管理者権限を確認できませんでした。時間をおいて再度お試しください。');
  }
  return (
    <div className={styles.shell}>
      <header className={styles.header}><Link href="/admin">管理コンソール</Link><span>管理者専用</span></header>
      <div className={styles.body}>
        <AdminNavigation />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
