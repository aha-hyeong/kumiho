import { useState, useEffect } from "react";
import { Library, Trash2, Plus, RefreshCw, FolderOpen, Check, AlertCircle, Settings } from "lucide-react";
import { libraryAPI } from "../../api/client";
import styles from "./GeneralTab.module.css";

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

  // 상태 메시지 자동 삭제
  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => {
        setStatus(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

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
            <h2>라이브러리 관리</h2>
            <p className={styles.tabDescription}>미디어 파일이 위치한 폴더를 관리합니다.</p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className={styles.settingsSelect}
              style={{ width: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Plus size={16} />
              라이브러리 추가
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
            <FolderOpen size={18} />
            <h3>새 라이브러리 추가</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label>경로 설정</label>
                <p>서버 내의 실제 폴더 경로를 입력하세요.</p>
              </div>
              <div
                className={styles.itemControl}
                style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
              >
                <input
                  type="text"
                  placeholder="라이브러리 이름 (예: 만화책)"
                  value={newLibrary.name}
                  onChange={(e) => setNewLibrary({ ...newLibrary, name: e.target.value })}
                  className={styles.settingsInput}
                />
                <input
                  type="text"
                  placeholder="폴더 경로 (예: /data/comics)"
                  value={newLibrary.path}
                  onChange={(e) => setNewLibrary({ ...newLibrary, path: e.target.value })}
                  className={styles.settingsInput}
                />
              </div>
            </div>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label>기본 뷰어 설정</label>
                <p>이 라이브러리의 기본 보기 방식을 설정합니다.</p>
              </div>
              <div
                className={styles.itemControl}
                style={{ display: "flex", gap: "1rem" }}
              >
                <select
                  value={newLibrary.default_view_mode}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_view_mode: e.target.value })}
                  className={styles.settingsSelect}
                  style={{ flex: 1 }}
                >
                  <option value="single">한 페이지</option>
                  <option value="double">두 페이지</option>
                  <option value="vertical">세로 스크롤</option>
                </select>
                <select
                  value={newLibrary.default_read_direction}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_read_direction: e.target.value })}
                  className={styles.settingsSelect}
                  style={{ flex: 1 }}
                >
                  <option value="ltr">왼쪽에서 오른쪽</option>
                  <option value="rtl">오른쪽에서 왼쪽</option>
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
                onClick={handleCreateLibrary}
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
          {libraries.map((lib) => (
            <div
              key={lib.id}
              style={{ marginBottom: "1rem" }}
            >
              <div
                className={styles.settingsItem}
                style={{ padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}
              >
                <div className={styles.itemInfo}>
                  <label style={{ fontSize: "1.1rem" }}>{lib.name}</label>
                  <p style={{ fontFamily: "monospace", marginTop: "0.25rem" }}>{lib.path}</p>
                  <div
                    style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", opacity: 0.6, fontSize: "0.8rem" }}
                  >
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
                <div
                  className={styles.itemControl}
                  style={{ minWidth: "auto", display: "flex", gap: "0.5rem" }}
                >
                  <button
                    onClick={() => setEditingLibrary(editingLibrary?.id === lib.id ? null : lib)}
                    className={styles.settingsSelect}
                    style={{
                      width: "auto",
                      padding: "0.5rem",
                      color: "#63b3ed",
                      borderColor: "rgba(99, 179, 237, 0.3)",
                    }}
                    title="설정 수정"
                  >
                    <Settings size={16} />
                  </button>
                  <button
                    onClick={() => handleScanLibrary(lib.id)}
                    className={styles.settingsSelect}
                    style={{
                      width: "auto",
                      padding: "0.5rem",
                      color: "#68d391",
                      borderColor: "rgba(104, 211, 145, 0.3)",
                    }}
                    title="지금 스캔"
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteLibrary(lib.id)}
                    className={styles.settingsSelect}
                    style={{
                      width: "auto",
                      padding: "0.5rem",
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
                <div
                  style={{
                    padding: "1rem",
                    marginTop: "0.5rem",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.4rem", opacity: 0.7 }}>
                        라이브러리 이름
                      </label>
                      <input
                        type="text"
                        value={editingLibrary.name}
                        onChange={(e) => setEditingLibrary({ ...editingLibrary, name: e.target.value })}
                        className={styles.settingsInput}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.4rem", opacity: 0.7 }}>
                        보기 모드
                      </label>
                      <select
                        value={editingLibrary.default_view_mode}
                        onChange={(e) => setEditingLibrary({ ...editingLibrary, default_view_mode: e.target.value })}
                        className={styles.settingsSelect}
                      >
                        <option value="single">한 페이지</option>
                        <option value="double">두 페이지</option>
                        <option value="vertical">세로 스크롤</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.4rem", opacity: 0.7 }}>
                        읽기 방향
                      </label>
                      <select
                        value={editingLibrary.default_read_direction}
                        onChange={(e) =>
                          setEditingLibrary({ ...editingLibrary, default_read_direction: e.target.value })
                        }
                        className={styles.settingsSelect}
                      >
                        <option value="ltr">왼쪽에서 오른쪽</option>
                        <option value="rtl">오른쪽에서 왼쪽</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        onClick={() => handleUpdateLibrary(lib.id, editingLibrary)}
                        className={styles.settingsSelect}
                        style={{ width: "auto", background: "#4a5568" }}
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditingLibrary(null)}
                        className={styles.settingsSelect}
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
          {libraries.length === 0 && <div className={styles.placeholderContent}>라이브러리가 없습니다.</div>}
        </div>
      )}
    </div>
  );
}
