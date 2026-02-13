import { createPortal } from "react-dom";
import { X, Monitor, Clock, LogOut, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import styles from "./UserSessionsModal.module.css";
import type { User } from "../../types/user";
import type { Session } from "../../types/session";
import { getDeviceIcon, formatRelativeTime } from "../../utils/session";

interface UserSessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  sessions: Session[];
  onRevoke: (sessionId: string) => void;
  isLoading?: boolean;
}

export function UserSessionsModal({
  isOpen,
  onClose,
  user,
  sessions,
  onRevoke,
  isLoading = false,
}: UserSessionsModalProps) {
  const { t } = useTranslation();

  if (!isOpen || !user) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleInfo}>
            <Monitor
              className={styles.titleIcon}
              size={24}
            />
            <div>
              <h3>{t("settings.users.sessions_modal.title", { nickname: user.nickname })}</h3>
              <p>{t("settings.users.sessions_modal.desc")}</p>
            </div>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className={styles.sessionList}>
          {isLoading ? (
            <div className={styles.loading}>{t("common.loading")}</div>
          ) : sessions.length === 0 ? (
            <div className={styles.empty}>
              <ShieldAlert
                size={48}
                opacity={0.2}
              />
              <p>{t("settings.account.sessions.no_sessions")}</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={styles.sessionItem}
              >
                <div className={styles.sessionMain}>
                  <div className={styles.deviceIcon}>{getDeviceIcon(session.device_type)}</div>
                  <div className={styles.sessionDeets}>
                    <div className={styles.deviceName}>{session.device_name || session.os || "Unknown Device"}</div>
                    <div className={styles.sessionMeta}>
                      <span>
                        {session.browser} ({session.os})
                      </span>
                      <span className={styles.dot}>•</span>
                      <span>{session.ip_address}</span>
                    </div>
                    <div className={styles.lastActive}>
                      <Clock size={12} />
                      <span>
                        {t("settings.account.sessions.last_active")}: {formatRelativeTime(session.last_active_at, t)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  className={styles.revokeBtn}
                  onClick={() => onRevoke(session.id)}
                  title={t("settings.users.sessions_modal.revoke")}
                >
                  <LogOut size={16} />
                  <span>{t("settings.users.sessions_modal.revoke")}</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
