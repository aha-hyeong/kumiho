import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle, Info, XCircle } from "lucide-react";
import "./AlertModal.css";

export type AlertType = "success" | "error" | "warning" | "info";

interface AlertModalProps {
  isOpen: boolean;
  type?: AlertType;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const colorMap = {
  success: "#48bb78",
  error: "#f56565",
  warning: "#ed8936",
  info: "#667eea",
};

export function AlertModal({
  isOpen,
  type = "info",
  title,
  message,
  confirmText = "확인",
  cancelText = "취소",
  showCancel = false,
  onConfirm,
  onCancel,
}: AlertModalProps) {
  if (!isOpen) return null;

  const Icon = iconMap[type];
  const color = colorMap[type];

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      if (showCancel && onCancel) {
        onCancel();
      } else {
        onConfirm();
      }
    }
  };

  return createPortal(
    <div
      className="alert-modal-overlay"
      onClick={handleBackdropClick}
    >
      <div className="alert-modal-content">
        <div
          className="alert-modal-icon"
          style={{ color }}
        >
          <Icon size={48} />
        </div>

        {title && <h3 className="alert-modal-title">{title}</h3>}
        <p className="alert-modal-message">{message}</p>

        <div className="alert-modal-actions">
          {showCancel && (
            <button
              className="alert-modal-btn btn-cancel"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
          <button
            className="alert-modal-btn btn-confirm"
            style={{ backgroundColor: color }}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
