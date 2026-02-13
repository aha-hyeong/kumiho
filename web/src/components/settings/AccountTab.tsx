import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { User, Lock, Save, Monitor, Smartphone, Tablet, Globe, LogOut } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { authAPI, sessionAPI } from "../../api/client";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./AccountTab.module.css";
import { Toast } from "../common/Toast";
import type { Session } from "../../types/session";

export function AccountTab() {
  const { t } = useTranslation();
  const { user, checkAuth } = useAuthStore();
  const [nickname, setNickname] = useState(user?.nickname || "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 세션 관련 상태
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname);
    }
  }, [user]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  // 세션 목록 로드
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await sessionAPI.getMySessions();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error("Failed to load sessions:", error);
      showToast("error", t("settings.account.sessions.load_failed"));
    } finally {
      setSessionsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleProfileUpdate = async () => {
    if (!nickname.trim()) {
      showToast("error", t("settings.account.toast.empty_nickname"));
      return;
    }

    try {
      await authAPI.updateProfile({ nickname });
      await checkAuth();
      showToast("success", t("settings.account.toast.profile_updated"));
    } catch (error) {
      console.error("Failed to update profile:", error);
      showToast("error", t("settings.account.toast.profile_update_failed"));
    }
  };

  const handlePasswordChange = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      showToast("error", t("settings.account.toast.empty_fields"));
      return;
    }

    if (newPassword.length < 8) {
      showToast("error", t("settings.account.toast.password_too_short"));
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast("error", t("settings.account.toast.password_mismatch"));
      return;
    }

    try {
      await authAPI.changePassword({ old_password: oldPassword, new_password: newPassword });
      showToast("success", t("settings.account.toast.password_changed"));
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: unknown) {
      console.error("Failed to change password:", error);
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 401) {
        showToast("error", t("settings.account.toast.wrong_password"));
      } else {
        showToast("error", t("settings.account.toast.password_change_failed"));
      }
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!window.confirm(t("settings.account.sessions.revoke_confirm_msg"))) return;
    try {
      await sessionAPI.revokeSession(sessionId);
      showToast("success", t("settings.account.sessions.revoked"));
      await loadSessions();
    } catch (error) {
      console.error("Failed to revoke session:", error);
      showToast("error", t("settings.account.sessions.revoke_failed"));
    }
  };

  const handleRevokeOtherSessions = async () => {
    if (!window.confirm(t("settings.account.sessions.revoke_all_confirm_msg"))) return;
    try {
      await sessionAPI.revokeOtherSessions();
      showToast("success", t("settings.account.sessions.all_revoked"));
      await loadSessions();
    } catch (error) {
      console.error("Failed to revoke other sessions:", error);
      showToast("error", t("settings.account.sessions.revoke_all_failed"));
    }
  };

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

  return (
    <div className={styles.accountContainer}>
      {toast && (
        <div style={{ position: "fixed", top: "2rem", right: "2rem", zIndex: 9999 }}>
          <Toast
            type={toast.type}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        </div>
      )}

      <div className={commonStyles.tabHeader}>
        <h2>{t("settings.account.title")}</h2>
        <p className={commonStyles.tabDescription}>{t("settings.account.desc")}</p>
      </div>

      <div className={commonStyles.settingsSections}>
        {/* 프로필 설정 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <User size={18} />
            <h3>{t("settings.account.profile.title")}</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.accountGrid}>
              <div className={styles.gridLabel}>
                <div className={commonStyles.itemInfo}>
                  <label htmlFor="nickname">{t("settings.account.profile.nickname_label")}</label>
                  <p>{t("settings.account.profile.nickname_desc")}</p>
                </div>
              </div>
              <div className={styles.gridControl}>
                <div className={styles.profileInputGroup}>
                  <input
                    type="text"
                    id="nickname"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className={commonStyles.settingsInput}
                  />
                  <button
                    onClick={handleProfileUpdate}
                    className={`${commonStyles.settingsSelect} ${styles.saveButton}`}
                  >
                    <Save size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 비밀번호 변경 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <Lock size={18} />
            <h3>{t("settings.account.password.title")}</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.accountGrid}>
              <div className={styles.gridLabel}>
                <div className={commonStyles.itemInfo}>
                  <label htmlFor="old-password">{t("settings.account.password.current_label")}</label>
                </div>
              </div>
              <div className={styles.gridControl}>
                <input
                  type="password"
                  id="old-password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder={t("settings.account.password.current_placeholder")}
                />
              </div>

              <div className={styles.gridLabel}>
                <div className={commonStyles.itemInfo}>
                  <label htmlFor="new-password">{t("settings.account.password.new_label")}</label>
                  <p>{t("settings.account.password.new_desc")}</p>
                </div>
              </div>
              <div className={styles.gridControl}>
                <input
                  type="password"
                  id="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder={t("settings.account.password.new_label")}
                />
              </div>

              <div className={styles.gridLabel}>
                <div className={commonStyles.itemInfo}>
                  <label htmlFor="confirm-password">{t("settings.account.password.confirm_label")}</label>
                </div>
              </div>
              <div className={styles.gridControl}>
                <input
                  type="password"
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder={t("settings.account.password.confirm_placeholder")}
                />
              </div>

              <div className={styles.passwordActions}>
                <button
                  onClick={handlePasswordChange}
                  className={`${commonStyles.settingsSelect} ${styles.changePasswordButton}`}
                >
                  {t("settings.account.password.button")}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 활성 세션 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <Monitor size={18} />
            <h3>{t("settings.account.sessions.title")}</h3>
          </div>
          <p className={styles.sessionDesc}>{t("settings.account.sessions.desc")}</p>

          <div className={styles.sessionList}>
            {sessionsLoading ? (
              <div className={styles.sessionLoading}>{t("common.loading")}</div>
            ) : sessions.length === 0 ? (
              <div className={styles.sessionEmpty}>{t("settings.account.sessions.no_sessions")}</div>
            ) : (
              <>
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`${styles.sessionItem} ${session.is_current ? styles.sessionCurrent : ""}`}
                  >
                    <div className={styles.sessionIcon}>{getDeviceIcon(session.device_type)}</div>
                    <div className={styles.sessionInfo}>
                      <div className={styles.sessionDeviceName}>
                        {session.device_name}
                        {session.is_current && (
                          <span className={styles.currentBadge}>{t("settings.account.sessions.this_device")}</span>
                        )}
                      </div>
                      <div className={styles.sessionMeta}>
                        <span>{session.ip_address}</span>
                        <span className={styles.sessionDot}>·</span>
                        <span>{formatRelativeTime(session.last_active_at)}</span>
                      </div>
                    </div>
                    {!session.is_current && (
                      <button
                        className={styles.revokeButton}
                        onClick={() => handleRevokeSession(session.id)}
                      >
                        <LogOut size={14} />
                        <span>{t("settings.account.sessions.revoke")}</span>
                      </button>
                    )}
                  </div>
                ))}

                {sessions.length > 1 && (
                  <button
                    className={styles.revokeAllButton}
                    onClick={handleRevokeOtherSessions}
                  >
                    {t("settings.account.sessions.revoke_all_others")}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
