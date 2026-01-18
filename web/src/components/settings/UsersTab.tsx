import { useState, useEffect } from "react";
import { Users, Trash2, Plus, Check, AlertCircle } from "lucide-react";
import { usersAPI } from "../../api/client";
import styles from "./GeneralTab.module.css";
import { useAuthStore } from "../../stores/authStore";
import type { User } from "../../types/user";

export function UsersTab() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // New user form state
  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    password: "",
    role: "USER" as "MASTER" | "USER",
  });

  const fetchUsers = async () => {
    try {
      const response = await usersAPI.getAll();
      const data = response.data;
      setUsers(data.users || []);
    } catch (error) {
      console.error("Failed to fetch users:", error);
      setStatus({ type: "error", message: "사용자 목록을 불러오는데 실패했습니다." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async () => {
    if (!newUser.username || !newUser.email || !newUser.password) {
      setStatus({ type: "error", message: "모든 필수 항목을 입력해주세요." });
      return;
    }

    try {
      await usersAPI.create(newUser);
      setStatus({ type: "success", message: "사용자가 생성되었습니다." });
      setIsCreating(false);
      setNewUser({ username: "", email: "", password: "", role: "USER" });
      fetchUsers();
    } catch (error: any) {
      console.error("Failed to create user:", error);
      setStatus({ type: "error", message: error.response?.data?.error || "사용자 생성에 실패했습니다." });
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm("정말로 이 사용자를 삭제하시겠습니까?")) return;

    try {
      await usersAPI.delete(id);
      setStatus({ type: "success", message: "사용자가 삭제되었습니다." });
      fetchUsers();
    } catch (error) {
      console.error("Failed to delete user:", error);
      setStatus({ type: "error", message: "사용자 삭제에 실패했습니다." });
    }
  };

  return (
    <div className={`${styles.tabContent} ${styles.relative}`}>
      {status && (
        <div
          role="status"
          className={`${styles.statusMessage} ${status.type === "success" ? styles.success : styles.error}`}
          onClick={() => setStatus(null)}
        >
          {status.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
          {status.message}
        </div>
      )}

      <div className={styles.tabHeader}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2>사용자 관리</h2>
            <p className={styles.tabDescription}>시스템에 접근할 수 있는 사용자를 관리합니다.</p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className={styles.settingsSelect}
              style={{ width: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Plus size={16} />
              사용자 추가
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <div
          className={styles.settingsSection}
          style={{
            marginBottom: "2rem",
            padding: "1.5rem",
            background: "rgba(255,255,255,0.03)",
            borderRadius: "12px",
          }}
        >
          <div className={styles.sectionTitle}>
            <Users size={18} />
            <h3>새 사용자 추가</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label>계정 정보</label>
                <p>사용자 접속 정보를 입력하세요.</p>
              </div>
              <div
                className={styles.itemControl}
                style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
              >
                <input
                  type="text"
                  placeholder="아이디 (Username)"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className={styles.settingsInput}
                />
                <input
                  type="email"
                  placeholder="이메일"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className={styles.settingsInput}
                />
                <input
                  type="password"
                  placeholder="비밀번호 (8자 이상)"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className={styles.settingsInput}
                />
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as "MASTER" | "USER" })}
                  className={styles.settingsSelect}
                >
                  <option value="USER">일반 사용자 (USER)</option>
                  <option value="MASTER">관리자 (MASTER)</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                onClick={() => setIsCreating(false)}
                className={styles.settingsSelect}
                style={{ width: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                취소
              </button>
              <button
                onClick={handleCreateUser}
                className={styles.settingsSelect}
                style={{ width: "auto", background: "#4a5568" }}
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className={styles.placeholderContent}>Loading...</div>
      ) : (
        <div className={styles.settingsSections}>
          {users.map((u) => (
            <div
              key={u.id}
              className={styles.settingsItem}
              style={{ padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}
            >
              <div className={styles.itemInfo}>
                <label style={{ fontSize: "1.1rem" }}>{u.username}</label>
                <p>{u.email}</p>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.2rem 0.5rem",
                      background: u.role === "MASTER" ? "#805ad5" : "#4a5568",
                      borderRadius: "4px",
                      color: "white",
                    }}
                  >
                    {u.role}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#718096" }}>
                    가입일: {new Date(u.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div
                className={styles.itemControl}
                style={{ minWidth: "auto" }}
              >
                {currentUser?.id !== u.id && u.role !== "MASTER" && (
                  <button
                    onClick={() => handleDeleteUser(u.id)}
                    className={styles.settingsSelect}
                    style={{
                      width: "auto",
                      padding: "0.5rem",
                      color: "#fc8181",
                      borderColor: "rgba(252, 129, 129, 0.3)",
                    }}
                    title="사용자 삭제"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && <div className={styles.placeholderContent}>사용자가 없습니다.</div>}
        </div>
      )}
    </div>
  );
}
