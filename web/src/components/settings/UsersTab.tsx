import { useState, useEffect } from "react";
import { AlertModal } from "../modals/AlertModal";
import { Plus, Trash2, Edit2, Save, X, Users } from "lucide-react";
import { usersAPI } from "../../api/client";
import { Toast } from "../common/Toast";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./UsersTab.module.css";
import { useAuthStore } from "../../stores/authStore";
import { useLibraryStore } from "../../stores/libraryStore";
import type { User } from "../../types/user";

export function UsersTab() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingLibs, setEditingLibs] = useState<string[]>([]);
  const [editingCanDownload, setEditingCanDownload] = useState(false);

  // New user form state
  const [newUser, setNewUser] = useState({
    username: "",
    nickname: "",
    password: "",
    role: "USER" as "MASTER" | "USER",
    can_download: false,
    library_ids: [] as string[],
  });

  const { libraries, fetchLibraries } = useLibraryStore();

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
    fetchLibraries();
  }, [fetchLibraries]);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);

  const handleLibraryToggle = (id: string) => {
    setNewUser((prev) => ({
      ...prev,
      library_ids: prev.library_ids.includes(id)
        ? prev.library_ids.filter((libId) => libId !== id)
        : [...prev.library_ids, id],
    }));
  };

  const handleCreateUser = async () => {
    if (!newUser.username || !newUser.nickname || !newUser.password) {
      setStatus({ type: "error", message: "모든 필수 항목을 입력해주세요." });
      return;
    }

    try {
      await usersAPI.create(newUser);
      setStatus({ type: "success", message: "사용자가 생성되었습니다." });
      setStatus({ type: "success", message: "사용자가 생성되었습니다." });
      setIsCreating(false);
      setNewUser({ username: "", nickname: "", password: "", role: "USER", can_download: false, library_ids: [] });
      fetchUsers();
    } catch (error: any) {
      console.error("Failed to create user:", error);
      setStatus({ type: "error", message: error.response?.data?.error || "사용자 생성에 실패했습니다." });
    }
  };

  const handleUpdate = async (id: string, user: User) => {
    try {
      const updateData = {
        nickname: user.nickname,
        role: user.role,
        library_ids: editingLibs,
        can_download: editingCanDownload,
      };
      await usersAPI.update(id, updateData);

      // 라이브러리 권한은 별도 API 사용 (필요한 경우) - 현재 통합 update API를 만들었으므로 updateData로 한 번에 처리하거나,
      // 백엔드에서 update API가 library_ids 처리를 안 한다면 updateLibraries 호출 필요.
      // 백엔드 UserHandler.Update는 library_ids를 안 받았음 (UpdateUserRequest 정의 참고).
      // 따라서 updateLibraries도 호출해야 함.
      if (user.role === "USER") {
        await usersAPI.updateLibraries(id, editingLibs);
      }

      setStatus({ type: "success", message: "사용자 정보가 업데이트되었습니다." });
      setEditingUserId(null);
      fetchUsers();
    } catch (error: any) {
      console.error("Failed to update user:", error);
      setStatus({ type: "error", message: error.response?.data?.error || "업데이트에 실패했습니다." });
    }
  };

  const startEditing = (user: User) => {
    setEditingUserId(user.id);
    setEditingLibs(user.allowed_library_ids || []);
    setEditingCanDownload(user.can_download || false);
  };

  const toggleEditingLib = (libId: string) => {
    setEditingLibs((prev) => (prev.includes(libId) ? prev.filter((id) => id !== libId) : [...prev, libId]));
  };

  const handleDeleteClick = (id: string) => {
    setUserToDelete(id);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;

    try {
      await usersAPI.delete(userToDelete);
      setStatus({ type: "success", message: "사용자가 삭제되었습니다." });
      setDeleteModalOpen(false);
      setUserToDelete(null);
      fetchUsers();
    } catch (error: any) {
      console.error("Failed to delete user:", error);
      setStatus({
        type: "error",
        message: error.response?.data?.error || "사용자 삭제에 실패했습니다.",
      });
      setDeleteModalOpen(false);
      setUserToDelete(null);
    }
  };

  return (
    <div className={`${styles.tabContent} ${styles.relative}`}>
      <AlertModal
        isOpen={deleteModalOpen}
        type="warning"
        title="사용자 삭제"
        message="정말로 이 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
        confirmText="삭제"
        cancelText="취소"
        showCancel={true}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteModalOpen(false);
          setUserToDelete(null);
        }}
      />
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}

      <div className={commonStyles.tabHeader}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2>사용자 관리</h2>
            <p className={commonStyles.tabDescription}>시스템에 접근할 수 있는 사용자를 관리합니다.</p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className={commonStyles.settingsSelect}
              style={{ width: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Plus size={16} />
              사용자 추가
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <div className={`${commonStyles.settingsSection} ${styles.createForm}`}>
          <div className={commonStyles.sectionTitle}>
            <Users size={18} />
            <h3>새 사용자 추가</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>계정 정보</label>
                <p>사용자 접속 정보를 입력하세요.</p>
              </div>
              <div className={`${commonStyles.itemControl} ${styles.inputGroup}`}>
                <input
                  type="text"
                  placeholder="아이디 (Login ID)"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className={commonStyles.settingsInput}
                />
                <input
                  type="text"
                  placeholder="사용자명 (Nickname)"
                  value={newUser.nickname}
                  onChange={(e) => setNewUser({ ...newUser, nickname: e.target.value })}
                  className={commonStyles.settingsInput}
                />
                <input
                  type="password"
                  placeholder="비밀번호 (8자 이상)"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className={commonStyles.settingsInput}
                />
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as "MASTER" | "USER" })}
                  className={commonStyles.settingsSelect}
                >
                  <option value="USER">일반 사용자 (USER)</option>
                  <option value="MASTER">관리자 (MASTER)</option>
                </select>
              </div>
            </div>

            {newUser.role === "USER" && (
              <div className={commonStyles.settingsItem}>
                <div className={commonStyles.itemInfo}>
                  <label>다운로드 권한</label>
                  <p>이 사용자에게 시리즈 다운로드 권한을 부여합니다.</p>
                </div>
                <div className={commonStyles.itemControl}>
                  <label className={styles.libraryCheckbox}>
                    <input
                      type="checkbox"
                      checked={newUser.can_download}
                      onChange={(e) => setNewUser({ ...newUser, can_download: e.target.checked })}
                    />
                    <span>파일 다운로드 허용</span>
                  </label>
                </div>
              </div>
            )}

            {newUser.role === "USER" && (
              <div className={commonStyles.settingsItem}>
                <div className={commonStyles.itemInfo}>
                  <label>라이브러리 권한</label>
                  <p>이 사용자가 접근할 수 있는 라이브러리를 선택하세요.</p>
                </div>
                <div className={`${commonStyles.itemControl} ${styles.libraryGrid}`}>
                  {libraries
                    .filter((lib) => lib.type !== "SYSTEM")
                    .map((lib) => (
                      <label
                        key={lib.id}
                        className={styles.libraryCheckbox}
                      >
                        <input
                          type="checkbox"
                          checked={newUser.library_ids.includes(lib.id)}
                          onChange={() => handleLibraryToggle(lib.id)}
                        />
                        <span>{lib.name}</span>
                      </label>
                    ))}
                  {libraries.filter((lib) => lib.type !== "SYSTEM").length === 0 && (
                    <p className={styles.noLibraryHint}>설정된 라이브러리가 없습니다.</p>
                  )}
                </div>
              </div>
            )}
            <div className={styles.formActions}>
              <button
                onClick={() => setIsCreating(false)}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                취소
              </button>
              <button
                onClick={handleCreateUser}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "#4a5568" }}
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className={commonStyles.placeholderContent}>Loading...</div>
      ) : (
        <div className={styles.userList}>
          {users.map((u) => (
            <div
              key={u.id}
              className={`${commonStyles.settingsItem} ${styles.userItem}`}
            >
              <div className={commonStyles.itemInfo}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className={`${styles.roleBadge} ${u.role === "MASTER" ? styles.roleMaster : styles.roleUser}`}>
                    {u.role}
                  </span>
                  <label style={{ fontSize: "1.1rem" }}>{u.nickname}</label>
                </div>
                <p>ID: {u.username}</p>
                <div className={styles.userMeta}>
                  <span className={styles.joinDate}>가입일: {new Date(u.created_at).toLocaleDateString()}</span>
                  {u.role === "USER" &&
                    (editingUserId === u.id ? (
                      <label
                        className={styles.libraryCheckbox}
                        style={{ marginLeft: "1rem" }}
                      >
                        <input
                          type="checkbox"
                          checked={editingCanDownload}
                          onChange={(e) => setEditingCanDownload(e.target.checked)}
                        />
                        <span>다운로드 허용</span>
                      </label>
                    ) : (
                      u.can_download && (
                        <span
                          className={styles.roleBadge}
                          style={{ background: "#38a169", marginLeft: "0.5rem", fontSize: "0.7rem" }}
                        >
                          다운로드 가능
                        </span>
                      )
                    ))}
                </div>
                {u.role === "USER" && (
                  <div className={styles.allowedLibs}>
                    {editingUserId === u.id ? (
                      <div className={styles.editLibsContent}>
                        <p style={{ marginBottom: "0.5rem", color: "#a0aec0" }}>라이브러리 권한 수정:</p>
                        <div className={styles.libraryGrid}>
                          {libraries
                            .filter((lib) => lib.type !== "SYSTEM")
                            .map((lib) => (
                              <label
                                key={lib.id}
                                className={styles.libraryCheckbox}
                              >
                                <input
                                  type="checkbox"
                                  checked={editingLibs.includes(lib.id)}
                                  onChange={() => toggleEditingLib(lib.id)}
                                />
                                <span>{lib.name}</span>
                              </label>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <p>
                        접근 가능 라이브러리:{" "}
                        {u.allowed_library_ids && u.allowed_library_ids.length > 0
                          ? u.allowed_library_ids
                              .map((id: string) => {
                                const lib = libraries.find((l) => l.id === id);
                                return lib ? lib.name : id;
                              })
                              .join(", ")
                          : "없음"}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div
                className={commonStyles.itemControl}
                style={{ minWidth: "auto", display: "flex", gap: "0.5rem" }}
              >
                {editingUserId === u.id ? (
                  <>
                    <button
                      onClick={() => handleUpdate(u.id, u)}
                      className={commonStyles.settingsSelect}
                      style={{ width: "auto", padding: "0.5rem", color: "#68d391" }}
                      title="저장"
                    >
                      <Save size={16} />
                    </button>
                    <button
                      onClick={() => setEditingUserId(null)}
                      className={commonStyles.settingsSelect}
                      style={{ width: "auto", padding: "0.5rem", color: "#a0aec0" }}
                      title="취소"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    {u.role === "USER" && (
                      <button
                        onClick={() => startEditing(u)}
                        className={commonStyles.settingsSelect}
                        style={{ width: "auto", padding: "0.5rem", color: "#63b3ed" }}
                        title="권한 수정"
                      >
                        <Edit2 size={16} />
                      </button>
                    )}
                    {currentUser?.id !== u.id && u.role !== "MASTER" && (
                      <button
                        onClick={() => handleDeleteClick(u.id)}
                        className={commonStyles.settingsSelect}
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
                  </>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && <div className={commonStyles.placeholderContent}>사용자가 없습니다.</div>}
        </div>
      )}
    </div>
  );
}
