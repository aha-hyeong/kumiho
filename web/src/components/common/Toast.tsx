import { useEffect } from "react";
import { Check, AlertCircle, Info } from "lucide-react";
import styles from "./Toast.module.css";

export interface ToastProps {
  type: "success" | "error" | "info";
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
  }, []);

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={type === "error" ? "assertive" : "polite"}
      className={`${styles.statusMessage} ${
        type === "success" ? styles.success : type === "info" ? styles.info : styles.error
      }`}
      onClick={onClose}
    >
      {type === "success" ? <Check size={14} /> : type === "info" ? <Info size={14} /> : <AlertCircle size={14} />}
      {message}
    </div>
  );
}
