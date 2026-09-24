import styles from "./Skeleton.module.css";

export function Skeleton({ lines = 3, label = "読み込み中" }: { lines?: number; label?: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => <span key={index} className={styles.line} aria-hidden="true" />)}
    </div>
  );
}
