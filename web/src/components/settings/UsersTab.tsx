import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AlertModal } from "../modals/AlertModal";
import { Plus, Trash2, Edit2, Save, X, Download, Folder, ShieldCheck, UserCheck } from "lucide-react";
import { usersAPI } from "../../api/client";
import { Toast } from "../common/Toast";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./UsersTab.module.css";
import { useAuthStore } from "../../stores/authStore";
import { useLibraryStore } from "../../stores/libraryStore";
import type { User as UserType } from "../../types/user";

export function UsersTab() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<UserType[]>([]);
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

  const fetchUsers = useCallback(async () => {
    try {
      const response = await usersAPI.getAll();
      const data = response.data;
      setUsers(data.users || []);
    } catch (error) {
      console.error("Failed to fetch users:", error);
      setStatus({ type: "error", message: t("settings.users.toast.fetch_failed") });
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchUsers();
    fetchLibraries();
  }, [fetchLibraries, fetchUsers]);

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
      setStatus({ type: "error", message: t("settings.users.toast.empty_fields") });
      return;
    }

    try {
      await usersAPI.create(newUser);
      setStatus({ type: "success", message: "사용자가 생성되었습니다." });
      setIsCreating(false);
      setNewUser({ username: "", nickname: "", password: "", role: "USER", can_download: false, library_ids: [] });
      fetchUsers();
    } catch (error: unknown) {
      console.error("Failed to create user:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.users.toast.create_failed") });
    }
  };

  const handleUpdate = async (id: string, user: UserType) => {
    try {
      const updateData = {
        nickname: user.nickname,
        role: user.role,
        can_download: editingCanDownload,
      };
      await usersAPI.update(id, updateData);

      if (user.role === "USER") {
        await usersAPI.updateLibraries(id, editingLibs);
      }

      setStatus({ type: "success", message: t("settings.users.toast.updated") });
      setEditingUserId(null);
      fetchUsers();
    } catch (error: unknown) {
      console.error("Failed to update user:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.users.toast.update_failed") });
    }
  };

  const startEditing = (user: UserType) => {
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
      setStatus({ type: "success", message: t("settings.users.toast.deleted") });
      setDeleteModalOpen(false);
      setUserToDelete(null);
      fetchUsers();
    } catch (error: unknown) {
      console.error("Failed to delete user:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({
        type: "error",
        message: err.response?.data?.error || t("settings.users.toast.delete_failed"),
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
        title={t("settings.users.delete_modal.title")}
        message={t("settings.users.delete_modal.message")}
        confirmText={t("common.confirm")}
        cancelText={t("common.cancel")}
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
            <h2>{t("settings.users.title")}</h2>
            <p className={commonStyles.tabDescription}>{t("settings.users.desc")}</p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className={commonStyles.settingsSelect}
              style={{ width: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Plus size={16} />
              {t("settings.users.add_button")}
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <div className={styles.createForm}>
          <div className={styles.section}>
            <div className={commonStyles.sectionTitle}>
              <UserCheck size={18} />
              <h3>{t("settings.users.create.account_info")}</h3>
            </div>
            <div className={`${commonStyles.sectionContent} ${styles.sectionContent}`}>
              <div className={styles.settingsItemCentered}>
                <div className={commonStyles.itemInfo}>
                  <label>{t("settings.users.create.required_info")}</label>
                  <p>{t("settings.users.create.required_desc")}</p>
                </div>
                <div className={styles.inputGroup}>
                  <input
                    type="text"
                    placeholder={t("settings.users.create.id_placeholder")}
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    className={commonStyles.settingsInput}
                  />
                  <input
                    type="text"
                    placeholder={t("settings.users.create.nickname_placeholder")}
                    value={newUser.nickname}
                    onChange={(e) => setNewUser({ ...newUser, nickname: e.target.value })}
                    className={commonStyles.settingsInput}
                  />
                  <input
                    type="password"
                    placeholder={t("settings.users.create.password_placeholder")}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className={commonStyles.settingsInput}
                  />
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as "MASTER" | "USER" })}
                    className={commonStyles.settingsSelect}
                  >
                    <option value="USER">{t("settings.users.create.role_user")}</option>
                    <option value="MASTER">{t("settings.users.create.role_master")}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {newUser.role === "USER" && (
            <div className={styles.section}>
              <div className={commonStyles.sectionTitle}>
                <ShieldCheck size={18} />
                <h3>{t("settings.users.create.permissions")}</h3>
              </div>
              <div className={`${commonStyles.sectionContent} ${styles.sectionContent}`}>
                <div className={styles.settingsItemCentered}>
                  <div className={commonStyles.itemInfo}>
                    <label>{t("settings.users.create.download_label")}</label>
                    <p>{t("settings.users.create.download_desc")}</p>
                  </div>
                  <div
                    className={commonStyles.itemControl}
                    style={{ minWidth: "auto" }}
                  >
                    <label className={styles.switch}>
                      <input
                        type="checkbox"
                        checked={newUser.can_download}
                        onChange={(e) => setNewUser({ ...newUser, can_download: e.target.checked })}
                        aria-label="파일 다운로드 허용"
                      />
                      <span className={styles.slider}></span>
                    </label>
                  </div>
                </div>

                <div
                  className={`${commonStyles.settingsItem} ${styles.settingsItemCentered}`}
                  style={{ alignItems: "flex-start" }}
                >
                  <div className={commonStyles.itemInfo}>
                    <label>{t("settings.users.create.library_access")}</label>
                    <p>{t("settings.users.create.library_access_desc")}</p>
                  </div>
                  <div className={styles.libraryGrid}>
                    {libraries
                      .filter((lib) => lib.type !== "SYSTEM")
                      .map((lib) => (
                        <label
                          key={lib.id}
                          className={`${styles.libraryChip} ${newUser.library_ids.includes(lib.id) ? styles.active : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={newUser.library_ids.includes(lib.id)}
                            onChange={() => handleLibraryToggle(lib.id)}
                          />
                          <div className={styles.chipIcon}>
                            <Folder size={16} />
                          </div>
                          <span>{lib.name}</span>
                        </label>
                      ))}
                    {libraries.filter((lib) => lib.type !== "SYSTEM").length === 0 && (
                      <p className={styles.noLibraryHint}>{t("settings.users.create.no_libraries")}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className={styles.formActions}>
            <button
              onClick={() => setIsCreating(false)}
              className={commonStyles.settingsSelect}
              style={{ width: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleCreateUser}
              className={commonStyles.settingsSelect}
              style={{ width: "auto", background: "#4a5568" }}
            >
              {t("common.confirm")}
            </button>
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
              className={styles.userItem}
            >
              <div className={commonStyles.settingsItem}>
                <div className={commonStyles.itemInfo}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                    <span
                      className={`${styles.roleBadge} ${u.role === "MASTER" ? styles.roleMaster : styles.roleUser}`}
                    >
                      {u.role}
                    </span>
                    <label style={{ fontSize: "1.2rem", fontWeight: 600 }}>{u.nickname}</label>
                    {u.can_download && u.role !== "MASTER" && (
                      <div
                        title={t("settings.users.list.allow_download")}
                        style={{ color: "#48bb78", display: "flex" }}
                      >
                        <Download size={16} />
                      </div>
                    )}
                  </div>
                  <p style={{ marginBottom: "0.5rem" }}>
                    {t("settings.users.list.id")}: {u.username}
                  </p>
                  <div className={styles.userMeta}>
                    <span className={styles.joinDate}>
                      {t("settings.users.list.joined")}: {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {u.role === "USER" && (
                    <div className={styles.allowedLibs}>
                      {editingUserId === u.id ? (
                        <div className={styles.editLibsContent}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: "1rem",
                            }}
                          >
                            <p style={{ margin: 0, color: "#e2e8f0", fontWeight: 500 }}>
                              {t("settings.users.list.edit_permissions")}
                            </p>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                              <span style={{ fontSize: "0.85rem", color: "#a0aec0" }}>
                                {t("settings.users.list.allow_download")}
                              </span>
                              <label className={styles.switch}>
                                <input
                                  type="checkbox"
                                  checked={editingCanDownload}
                                  onChange={(e) => setEditingCanDownload(e.target.checked)}
                                  aria-label="다운로드 허용"
                                />
                                <span className={styles.slider}></span>
                              </label>
                            </div>
                          </div>
                          <div className={styles.libraryGrid}>
                            {libraries
                              .filter((lib) => lib.type !== "SYSTEM")
                              .map((lib) => (
                                <label
                                  key={lib.id}
                                  className={`${styles.libraryChip} ${editingLibs.includes(lib.id) ? styles.active : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={editingLibs.includes(lib.id)}
                                    onChange={() => toggleEditingLib(lib.id)}
                                  />
                                  <div className={styles.chipIcon}>
                                    <Folder size={16} />
                                  </div>
                                  <span>{lib.name}</span>
                                </label>
                              ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
                          {u.allowed_library_ids && u.allowed_library_ids.length > 0 ? (
                            u.allowed_library_ids.map((id: string) => {
                              const lib = libraries.find((l) => l.id === id);
                              return (
                                <span
                                  key={id}
                                  style={{
                                    fontSize: "0.8rem",
                                    padding: "0.2rem 0.6rem",
                                    background: "rgba(255,255,255,0.05)",
                                    borderRadius: "4px",
                                    color: "#a0aec0",
                                  }}
                                >
                                  {lib ? lib.name : id}
                                </span>
                              );
                            })
                          ) : (
                            <span style={{ fontSize: "0.8rem", color: "#718096" }}>
                              {t("settings.users.list.no_allowed_libraries")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div
                  className={commonStyles.itemControl}
                  style={{ minWidth: "auto", display: "flex", gap: "0.75rem" }}
                >
                  {editingUserId === u.id ? (
                    <>
                      <button
                        onClick={() => handleUpdate(u.id, u)}
                        className={commonStyles.settingsSelect}
                        style={{
                          width: "auto",
                          padding: "0.6rem",
                          color: "#48bb78",
                          background: "rgba(72,187,120,0.1)",
                          border: "none",
                        }}
                        title={t("common.save")}
                      >
                        <Save size={18} />
                      </button>
                      <button
                        onClick={() => setEditingUserId(null)}
                        className={commonStyles.settingsSelect}
                        style={{
                          width: "auto",
                          padding: "0.6rem",
                          color: "#a0aec0",
                          background: "rgba(255,255,255,0.05)",
                          border: "none",
                        }}
                        title={t("common.cancel")}
                      >
                        <X size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      {u.role === "USER" && (
                        <button
                          onClick={() => startEditing(u)}
                          className={commonStyles.settingsSelect}
                          style={{
                            width: "auto",
                            padding: "0.6rem",
                            color: "#4299e1",
                            background: "rgba(66,153,225,0.1)",
                            border: "none",
                          }}
                          title={t("settings.users.list.edit_permissions")}
                        >
                          <Edit2 size={18} />
                        </button>
                      )}
                      {currentUser?.id !== u.id && u.role !== "MASTER" && (
                        <button
                          onClick={() => handleDeleteClick(u.id)}
                          className={commonStyles.settingsSelect}
                          style={{
                            width: "auto",
                            padding: "0.6rem",
                            color: "#f56565",
                            background: "rgba(245,101,101,0.1)",
                            border: "none",
                          }}
                          title={t("settings.users.delete_modal.title")}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className={commonStyles.placeholderContent}>{t("settings.users.list.empty")}</div>
          )}
        </div>
      )}
    </div>
  );
}
