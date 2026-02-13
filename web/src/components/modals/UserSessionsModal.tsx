import { createPortal } from "react-dom";
import { X, Monitor, Smartphone, Tablet, Globe, Clock, LogOut, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import styles from "./UserSessionsModal.module.css";
import type { User } from "../../types/user";

interface Session {
  id: string;
  user_id: string;
  device_name: string;
  device_type: string;
  browser: string;
  os: string;
  ip_address: string;
  last_active_at: string;
  created_at: string;
}

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

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType) {
      case "desktop":
        return <Monitor size={20} />;
      case "mobile":
        return <Smartphone size={20} />;
      case "tablet":
        return <Tablet size={20} />;
      default:
        return <Globe size={20} />;
    }
  };

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return t("settings.account.sessions.just_now");
    if (diffMin < 60) return t("settings.account.sessions.minutes_ago", { count: diffMin });
    if (diffHr < 24) return t("settings.account.sessions.hours_ago", { count: diffHr });
    return t("settings.account.sessions.days_ago", { count: diffDay });
  };

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
                        {t("settings.account.sessions.last_active")}: {formatRelativeTime(session.last_active_at)}
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
                  <span>{t("common.delete")}</span>
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
