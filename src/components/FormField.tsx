import { cloneElement, type AriaAttributes, type ReactElement } from "react";
import styles from "./FormField.module.css";

type FormControlProps = Pick<AriaAttributes, "aria-describedby" | "aria-invalid"> & { id?: string };
type FormFieldProps = { id: string; label: string; hint?: string; error?: string; children: ReactElement<FormControlProps> };

export function FormField({ id, label, hint, error, children }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {hint && <p className={styles.hint} id={hintId}>{hint}</p>}
      <div className={styles.control}>
        {cloneElement(children, {
          id,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
        })}
      </div>
      {error && <p className={styles.error} id={errorId}>{error}</p>}
    </div>
  );
}
