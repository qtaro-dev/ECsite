import type { ReactNode } from 'react';
import styles from './auth.module.css';

export function AuthPage({ children }: { children: ReactNode }) {
  return <main id="main-content" className={styles.page}>{children}</main>;
}
