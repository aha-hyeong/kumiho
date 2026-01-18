import { useEffect } from "react";
import { Check, AlertCircle } from "lucide-react";
import styles from "./Toast.module.css";

export interface ToastProps {
  type: "success" | "error";
  message: string;
  onClose: () => void;
  duration?: number;
}

export function Toast({ type, message, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [onClose, duration]);

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={type === "error" ? "assertive" : "polite"}
      className={`${styles.statusMessage} ${type === "success" ? styles.success : styles.error}`}
      onClick={onClose}
    >
      {type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
      {message}
    </div>
  );
}
