import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, BookCopy, Folder, RefreshCw, Plus, LogOut } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { libraryAPI, progressAPI } from "../api/client";
import "./Home.css";

interface Library {
  id: string;
  name: string;
  path: string;
  last_scanned_at?: string;
}

interface RecentProgress {
  id: string;
  series_id: string;
  series_title: string;
  current_page: number;
  total_pages: number;
  progress_percent: number;
  updated_at: string;
}

export function HomePage() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [recentProgress, setRecentProgress] = useState<RecentProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 라이브러리 추가 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLibName, setNewLibName] = useState("");
  const [newLibPath, setNewLibPath] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [libRes, progressRes] = await Promise.all([libraryAPI.getAll(), progressAPI.getRecent(5)]);
      setLibraries(libRes.data.libraries || []);
      setRecentProgress(progressRes.data.recent_progress || []);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    setIsAdding(true);

    try {
      await libraryAPI.create({ name: newLibName, path: newLibPath });
      setShowAddModal(false);
      setNewLibName("");
      setNewLibPath("");
      await loadData(); // 새로고침
    } catch (error: any) {
      setAddError(error.response?.data?.error || "라이브러리 추가에 실패했습니다");
    } finally {
      setIsAdding(false);
    }
  };

  const handleScanLibrary = async (libraryId: string) => {
    try {
      await libraryAPI.scan(libraryId);
      await loadData();
    } catch (error) {
      console.error("Scan failed:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
        <p>로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="home-container">
      <header className="home-header">
        <div className="header-left">
          <h1 className="logo">🦊 Kumiho</h1>
        </div>
        <div className="header-right">
          <span className="user-info">
            {user?.username}
            {user?.role === "MASTER" && <span className="role-badge">관리자</span>}
          </span>
          <button
            onClick={logout}
            className="logout-button"
          >
            <LogOut size={16} /> 로그아웃
          </button>
        </div>
      </header>

      <main className="home-main">
        {/* 이어보기 섹션 */}
        {recentProgress.length > 0 && (
          <section className="section">
            <h2 className="section-title">
              <BookOpen size={20} /> 이어보기
            </h2>
            <div className="recent-grid">
              {recentProgress.map((progress) => (
                <Link
                  key={progress.id}
                  to={`/series/${progress.series_id}`}
                  className="recent-card"
                >
                  <div className="recent-thumbnail">
                    <BookOpen size={28} />
                  </div>
                  <div className="recent-info">
                    <h3>{progress.series_title}</h3>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${progress.progress_percent}%` }}
                      />
                    </div>
                    <p className="progress-text">
                      {progress.current_page} / {progress.total_pages} 페이지
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 라이브러리 섹션 */}
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">
              <BookCopy size={20} /> 라이브러리
            </h2>
            {user?.role === "MASTER" && (
              <button
                onClick={() => setShowAddModal(true)}
                className="add-button"
              >
                <Plus size={16} /> 추가
              </button>
            )}
          </div>

          {libraries.length === 0 ? (
            <div className="empty-state">
              <p>등록된 라이브러리가 없습니다</p>
              {user?.role === "MASTER" && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="empty-button"
                >
                  라이브러리 추가하기
                </button>
              )}
            </div>
          ) : (
            <div className="library-grid">
              {libraries.map((library) => (
                <Link
                  key={library.id}
                  to={`/libraries/${library.id}`}
                  className="library-card"
                >
                  <div className="library-icon">
                    <Folder size={28} />
                  </div>
                  <div className="library-info">
                    <h3>{library.name}</h3>
                    <p className="library-path">{library.path}</p>
                    {library.last_scanned_at && (
                      <p className="library-scanned">
                        마지막 스캔: {new Date(library.last_scanned_at).toLocaleDateString()}
                      </p>
                    )}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handleScanLibrary(library.id);
                      }}
                      className="scan-button"
                    >
                      <RefreshCw size={14} /> 스캔
                    </button>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* 라이브러리 추가 모달 */}
      {showAddModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">라이브러리 추가</h2>
            <form
              onSubmit={handleAddLibrary}
              className="modal-form"
            >
              <div className="form-group">
                <label htmlFor="libName">라이브러리 이름</label>
                <input
                  type="text"
                  id="libName"
                  value={newLibName}
                  onChange={(e) => setNewLibName(e.target.value)}
                  placeholder="예: 만화책"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="libPath">경로</label>
                <input
                  type="text"
                  id="libPath"
                  value={newLibPath}
                  onChange={(e) => setNewLibPath(e.target.value)}
                  placeholder="예: /mnt/c/workspace/test"
                  required
                />
              </div>
              {addError && <div className="error-message">{addError}</div>}
              <div className="modal-buttons">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="cancel-button"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isAdding}
                  className="submit-button"
                >
                  {isAdding ? "추가 중..." : "추가"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
