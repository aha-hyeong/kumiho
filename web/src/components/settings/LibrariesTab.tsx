import { useState, useEffect } from "react";
import { Trash2, Plus, RefreshCw, FolderOpen, Settings } from "lucide-react";
import { libraryAPI } from "../../api/client";
import { Toast } from "../common/Toast";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./LibrariesTab.module.css";

interface Library {
  id: string;
  name: string;
  path: string;
  default_view_mode: string;
  default_read_direction: string;
}

export function LibrariesTab() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // New library form state
  const [newLibrary, setNewLibrary] = useState({
    name: "",
    path: "",
    default_view_mode: "single",
    default_read_direction: "ltr",
  });

  const fetchLibraries = async () => {
    try {
      const response = await libraryAPI.getAll();
      setLibraries(response.data.libraries || []);
    } catch (error) {
      console.error("Failed to fetch libraries:", error);
      setStatus({ type: "error", message: "라이브러리 목록을 불러오는데 실패했습니다." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLibraries();
  }, []);

  const handleCreateLibrary = async () => {
    if (!newLibrary.name || !newLibrary.path) {
      setStatus({ type: "error", message: "이름과 경로를 입력해주세요." });
      return;
    }

    try {
      await libraryAPI.create(newLibrary);
      setStatus({ type: "success", message: "라이브러리가 생성되었습니다." });
      setIsCreating(false);
      setNewLibrary({ name: "", path: "", default_view_mode: "single", default_read_direction: "ltr" });
      fetchLibraries();
    } catch (error: any) {
      console.error("Failed to create library:", error);
      setStatus({ type: "error", message: error.response?.data?.error || "라이브러리 생성에 실패했습니다." });
    }
  };

  const handleUpdateLibrary = async (id: string, data: Partial<Library>) => {
    try {
      await libraryAPI.update(id, data);
      setStatus({ type: "success", message: "라이브러리가 수정되었습니다." });
      setEditingLibrary(null);
      fetchLibraries();
    } catch (error: any) {
      console.error("Failed to update library:", error);
      setStatus({ type: "error", message: error.response?.data?.error || "라이브러리 수정에 실패했습니다." });
    }
  };

  const handleDeleteLibrary = async (id: string) => {
    if (!window.confirm("정말로 이 라이브러리를 삭제하시겠습니까? 메타데이터만 삭제되며 실제 파일은 유지됩니다."))
      return;

    try {
      await libraryAPI.delete(id);
      setStatus({ type: "success", message: "라이브러리가 삭제되었습니다." });
      fetchLibraries();
    } catch (error) {
      console.error("Failed to delete library:", error);
      setStatus({ type: "error", message: "라이브러리 삭제에 실패했습니다." });
    }
  };

  const handleScanLibrary = async (id: string) => {
    try {
      setStatus({ type: "success", message: "스캔이 시작되었습니다." }); // Optimistic UI
      await libraryAPI.scan(id);
      setStatus({ type: "success", message: "스캔이 완료되었습니다." });
    } catch (error) {
      console.error("Failed to scan library:", error);
      setStatus({ type: "error", message: "스캔 요청에 실패했습니다." });
    }
  };

  return (
    <div className={`${styles.tabContent} ${styles.relative}`}>
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
            <h2>라이브러리 관리</h2>
            <p className={commonStyles.tabDescription}>미디어 파일이 위치한 폴더를 관리합니다.</p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className={commonStyles.settingsSelect}
              style={{ width: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Plus size={16} />
              라이브러리 추가
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <div className={`${commonStyles.settingsSection} ${styles.createForm}`}>
          <div className={commonStyles.sectionTitle}>
            <FolderOpen size={18} />
            <h3>새 라이브러리 추가</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>경로 설정</label>
                <p>서버 내의 실제 폴더 경로를 입력하세요.</p>
              </div>
              <div className={`${commonStyles.itemControl} ${styles.inputGroup}`}>
                <input
                  type="text"
                  placeholder="라이브러리 이름 (예: 만화책)"
                  value={newLibrary.name}
                  onChange={(e) => setNewLibrary({ ...newLibrary, name: e.target.value })}
                  className={commonStyles.settingsInput}
                />
                <input
                  type="text"
                  placeholder="폴더 경로 (예: /data/comics)"
                  value={newLibrary.path}
                  onChange={(e) => setNewLibrary({ ...newLibrary, path: e.target.value })}
                  className={commonStyles.settingsInput}
                />
              </div>
            </div>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>기본 뷰어 설정</label>
                <p>이 라이브러리의 기본 보기 방식을 설정합니다.</p>
              </div>
              <div className={`${commonStyles.itemControl} ${styles.selectGroup}`}>
                <select
                  value={newLibrary.default_view_mode}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_view_mode: e.target.value })}
                  className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                >
                  <option value="single">한 페이지</option>
                  <option value="double">두 페이지</option>
                  <option value="vertical">세로 스크롤</option>
                </select>
                <select
                  value={newLibrary.default_read_direction}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_read_direction: e.target.value })}
                  className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                >
                  <option value="ltr">왼쪽에서 오른쪽</option>
                  <option value="rtl">오른쪽에서 왼쪽</option>
                </select>
              </div>
            </div>
            <div className={styles.formActions}>
              <button
                onClick={() => setIsCreating(false)}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                취소
              </button>
              <button
                onClick={handleCreateLibrary}
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
        <div className={styles.libraryList}>
          {libraries.map((lib) => (
            <div
              key={lib.id}
              className={styles.libraryItemContainer}
            >
              <div className={`${commonStyles.settingsItem} ${styles.libraryItem}`}>
                <div className={commonStyles.itemInfo}>
                  <label className={styles.libraryName}>{lib.name}</label>
                  <p className={styles.libraryPath}>{lib.path}</p>
                  <div className={styles.libraryMeta}>
                    <span>
                      {lib.default_view_mode === "single"
                        ? "한 페이지"
                        : lib.default_view_mode === "double"
                          ? "두 페이지"
                          : "세로 스크롤"}
                    </span>
                    <span>•</span>
                    <span>{lib.default_read_direction === "ltr" ? "왼쪽에서 오른쪽" : "오른쪽에서 왼쪽"}</span>
                  </div>
                </div>
                <div className={`${commonStyles.itemControl} ${styles.actionButtons}`}>
                  <button
                    onClick={() => setEditingLibrary(editingLibrary?.id === lib.id ? null : lib)}
                    className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
                    style={{
                      color: "#63b3ed",
                      borderColor: "rgba(99, 179, 237, 0.3)",
                    }}
                    title="설정 수정"
                  >
                    <Settings size={16} />
                  </button>
                  <button
                    onClick={() => handleScanLibrary(lib.id)}
                    className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
                    style={{
                      color: "#68d391",
                      borderColor: "rgba(104, 211, 145, 0.3)",
                    }}
                    title="지금 스캔"
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteLibrary(lib.id);
                    }}
                    className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
                    style={{
                      color: "#fc8181",
                      borderColor: "rgba(252, 129, 129, 0.3)",
                    }}
                    title="삭제"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {editingLibrary?.id === lib.id && (
                <div className={styles.editForm}>
                  <div className={styles.editGrid}>
                    <div className={styles.flexOne}>
                      <label className={styles.fieldLabel}>라이브러리 이름</label>
                      <input
                        type="text"
                        value={editingLibrary.name}
                        onChange={(e) => setEditingLibrary({ ...editingLibrary, name: e.target.value })}
                        className={commonStyles.settingsInput}
                      />
                    </div>
                    <div className={styles.flexOne}>
                      <label className={styles.fieldLabel}>보기 모드</label>
                      <select
                        value={editingLibrary.default_view_mode}
                        onChange={(e) => setEditingLibrary({ ...editingLibrary, default_view_mode: e.target.value })}
                        className={commonStyles.settingsSelect}
                      >
                        <option value="single">한 페이지</option>
                        <option value="double">두 페이지</option>
                        <option value="vertical">세로 스크롤</option>
                      </select>
                    </div>
                    <div className={styles.flexOne}>
                      <label className={styles.fieldLabel}>읽기 방향</label>
                      <select
                        value={editingLibrary.default_read_direction}
                        onChange={(e) =>
                          setEditingLibrary({ ...editingLibrary, default_read_direction: e.target.value })
                        }
                        className={commonStyles.settingsSelect}
                      >
                        <option value="ltr">왼쪽에서 오른쪽</option>
                        <option value="rtl">오른쪽에서 왼쪽</option>
                      </select>
                    </div>
                    <div className={styles.editActions}>
                      <button
                        onClick={() => handleUpdateLibrary(lib.id, editingLibrary)}
                        className={commonStyles.settingsSelect}
                        style={{ width: "auto", background: "#4a5568" }}
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditingLibrary(null)}
                        className={commonStyles.settingsSelect}
                        style={{ width: "auto", background: "transparent" }}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {libraries.length === 0 && <div className={commonStyles.placeholderContent}>라이브러리가 없습니다.</div>}
        </div>
      )}
    </div>
  );
}
