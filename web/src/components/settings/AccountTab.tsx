import { useState, useEffect } from "react";
import { User, Lock, Save } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { authAPI } from "../../api/client";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./AccountTab.module.css";
import { Toast } from "../common/Toast";

export function AccountTab() {
  const { user, checkAuth } = useAuthStore();
  const [nickname, setNickname] = useState(user?.nickname || "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname);
    }
  }, [user]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  const handleProfileUpdate = async () => {
    if (!nickname.trim()) {
      showToast("error", "사용자명을 입력해주세요.");
      return;
    }

    try {
      await authAPI.updateProfile({ nickname });
      await checkAuth();
      showToast("success", "프로필이 업데이트되었습니다.");
    } catch (error) {
      console.error("Failed to update profile:", error);
      showToast("error", "프로필 업데이트에 실패했습니다.");
    }
  };

  const handlePasswordChange = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      showToast("error", "모든 필드를 입력해주세요.");
      return;
    }

    if (newPassword.length < 8) {
      showToast("error", "새 비밀번호는 8자 이상이어야 합니다.");
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast("error", "새 비밀번호가 일치하지 않습니다.");
      return;
    }

    try {
      await authAPI.changePassword({ old_password: oldPassword, new_password: newPassword });
      showToast("success", "비밀번호가 변경되었습니다.");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: unknown) {
      console.error("Failed to change password:", error);
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 401) {
        showToast("error", "현재 비밀번호가 일치하지 않습니다.");
      } else {
        showToast("error", "비밀번호 변경에 실패했습니다.");
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
        <h2>내 계정</h2>
        <p className={commonStyles.tabDescription}>프로필 정보와 비밀번호를 관리합니다.</p>
      </div>

      <div className={commonStyles.settingsSections}>
        {/* 프로필 설정 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <User size={18} />
            <h3>프로필 설정</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.accountGrid}>
              <div className={styles.gridLabel}>
                <div className={commonStyles.itemInfo}>
                  <label htmlFor="nickname">사용자명</label>
                  <p>애플리케이션에서 표시될 이름입니다.</p>
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
            <h3>비밀번호 변경</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.accountGrid}>
              <div className={styles.gridLabel}>
                <div className={commonStyles.itemInfo}>
                  <label htmlFor="old-password">현재 비밀번호</label>
                </div>
              </div>
              <div className={styles.gridControl}>
                <input
                  type="password"
                  id="old-password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder="현재 사용 중인 비밀번호"
                />
              </div>

              <div className={styles.gridLabel}>
                <div className={commonStyles.itemInfo}>
                  <label htmlFor="new-password">새 비밀번호</label>
                  <p>8자 이상 입력해주세요.</p>
                </div>
              </div>
              <div className={styles.gridControl}>
                <input
                  type="password"
                  id="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder="새 비밀번호"
                />
              </div>

              <div className={styles.gridLabel}>
                <div className={commonStyles.itemInfo}>
                  <label htmlFor="confirm-password">새 비밀번호 확인</label>
                </div>
              </div>
              <div className={styles.gridControl}>
                <input
                  type="password"
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={commonStyles.settingsInput}
                  placeholder="새 비밀번호 다시 입력"
                />
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
          </div>
        </section>
      </div>
    </div>
  );
}
