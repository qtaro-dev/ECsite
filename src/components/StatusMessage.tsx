import type { ReactNode } from "react";
import styles from "./StatusMessage.module.css";

export type StatusKind = "info" | "warning" | "error" | "success";
const labels: Record<StatusKind, string> = { info: "お知らせ", warning: "注意", error: "エラー", success: "完了" };

export function StatusMessage({ kind, children, title }: { kind: StatusKind; children: ReactNode; title?: string }) {
  return (
    <section className={`${styles.message} ${styles[kind]}`} role={kind === "error" ? "alert" : "status"}>
      <strong className={styles.label}>{title ?? labels[kind]}</strong>
      <div>{children}</div>
    </section>
  );
}
