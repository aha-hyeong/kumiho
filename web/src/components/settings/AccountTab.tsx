import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { User, Lock, Save } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { authAPI } from "../../api/client";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./AccountTab.module.css";
import { Toast } from "../common/Toast";

export function AccountTab() {
  const { t } = useTranslation();
  const { user, checkAuth } = useAuthStore();
  const [nickname, setNickname] = useState(user?.nickname || "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNickname(user.nickname);
    }
  }, [user]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

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
      </div>
    </div>
  );
}
