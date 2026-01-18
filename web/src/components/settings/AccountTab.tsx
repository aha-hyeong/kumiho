import { useState, useEffect, useRef } from "react";
import { User, Lock, Check, AlertCircle, Save } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { authAPI } from "../../api/client";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./AccountTab.module.css";

export function AccountTab() {
  const { user, checkAuth } = useAuthStore();
  const [username, setUsername] = useState(user?.username || "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
    }
  }, [user]);

  // Status auto-clear
  useEffect(() => {
    if (status) {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => {
        setStatus(null);
        statusTimerRef.current = null;
      }, 3000);
    }
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [status]);

  const handleProfileUpdate = async () => {
    if (!username.trim()) {
      setStatus({ type: "error", message: "닉네임을 입력해주세요." });
      return;
    }

    try {
      await authAPI.updateProfile({ username });
      // Update local store by checking auth again
      await checkAuth();
      setStatus({ type: "success", message: "프로필이 업데이트되었습니다." });
    } catch (error) {
      console.error("Failed to update profile:", error);
      setStatus({ type: "error", message: "프로필 업데이트에 실패했습니다." });
    }
  };

  const handlePasswordChange = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setStatus({ type: "error", message: "모든 필드를 입력해주세요." });
      return;
    }

    if (newPassword.length < 8) {
      setStatus({ type: "error", message: "새 비밀번호는 8자 이상이어야 합니다." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus({ type: "error", message: "새 비밀번호가 일치하지 않습니다." });
      return;
    }

    try {
      await authAPI.changePassword({ old_password: oldPassword, new_password: newPassword });
      setStatus({ type: "success", message: "비밀번호가 변경되었습니다." });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      console.error("Failed to change password:", error);
      if (error.response?.status === 401) {
        setStatus({ type: "error", message: "현재 비밀번호가 일치하지 않습니다." });
      } else {
        setStatus({ type: "error", message: "비밀번호 변경에 실패했습니다." });
      }
    }
  };

  return (
    <div className={`${styles.tabContent} ${styles.relative}`}>
      {status && (
        <div
          role="status"
          className={`${styles.statusMessage} ${status.type === "success" ? styles.success : styles.error}`}
        >
          {status.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
          {status.message}
        </div>
      )}

      <div className={commonStyles.tabHeader}>
        <h2>내 계정</h2>
        <p className={commonStyles.tabDescription}>프로필 정보와 비밀번호를 관리합니다.</p>
      </div>

      <div className={styles.settingsSections}>
        {/* 프로필 설정 */}
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <User size={18} />
            <h3>프로필 설정</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="username">닉네임</label>
                <p>애플리케이션에서 표시될 이름입니다.</p>
              </div>
              <div className={commonStyles.itemControl}>
                <div className={styles.profileInputGroup}>
                  <input
                    type="text"
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
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
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Lock size={18} />
            <h3>비밀번호 변경</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="old-password">현재 비밀번호</label>
              </div>
              <div className={commonStyles.itemControl}>
                <input
                  type="password"
                  id="old-password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder="현재 사용 중인 비밀번호"
                />
              </div>
            </div>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="new-password">새 비밀번호</label>
                <p>8자 이상 입력해주세요.</p>
              </div>
              <div className={commonStyles.itemControl}>
                <input
                  type="password"
                  id="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder="새 비밀번호"
                />
              </div>
            </div>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="confirm-password">새 비밀번호 확인</label>
              </div>
              <div className={commonStyles.itemControl}>
                <input
                  type="password"
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder="새 비밀번호 다시 입력"
                />
              </div>
            </div>
            <div className={styles.passwordActions}>
              <button
                onClick={handlePasswordChange}
                className={`${commonStyles.settingsSelect} ${styles.changePasswordButton}`}
              >
                비밀번호 변경
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
