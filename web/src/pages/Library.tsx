import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Folder, RefreshCw } from "lucide-react";
import { libraryAPI } from "../api/client";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import type { Series } from "../types/series";
import "./Library.css";

interface Library {
  id: string;
  name: string;
  path: string;
  last_scanned_at?: string;
}

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();

  // 데이터 상태
  const [library, setLibrary] = useState<Library | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  // 라이브러리 추가 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLibName, setNewLibName] = useState("");
  const [newLibPath, setNewLibPath] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState("");

  useEffect(() => {
    if (id) {
      loadData();
      // ID가 바뀌면 사이드바 닫기 (선택적)
      setSidebarOpen(false);
    }
  }, [id]);

  const loadData = async () => {
    try {
      const [libRes, seriesRes] = await Promise.all([libraryAPI.get(id!), libraryAPI.getSeries(id!)]);
      setLibrary(libRes.data);
      setSeriesList(seriesRes.data.series || []);
    } catch (error) {
      console.error("Failed to load library:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScan = async () => {
    if (!id) return;
    setIsScanning(true);
    try {
      await libraryAPI.scan(id);
      await loadData();
    } catch (error) {
      console.error("Scan failed:", error);
    } finally {
      setIsScanning(false);
    }
  };

  // 라이브러리 추가 핸들러
  const handleAddLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    setIsAdding(true);

    try {
      // 1. 라이브러리 생성
      const createRes = await libraryAPI.create({ name: newLibName, path: newLibPath });
      const newLibraryId = createRes.data.id;

      // 2. 자동 스캔 실행
      await libraryAPI.scan(newLibraryId);

      // 3. 모달 닫고 상태 초기화
      setShowAddModal(false);
      setNewLibName("");
      setNewLibPath("");

      // 4. 사이드바 새로고침 트리거
      setSidebarRefreshKey((prev) => prev + 1);
    } catch (error: any) {
      setAddError(error.response?.data?.error || "라이브러리 추가에 실패했습니다");
    } finally {
      setIsAdding(false);
    }
  };

  const openAddLibraryModal = () => {
    setSidebarOpen(false);
    setShowAddModal(true);
  };

  if (isLoading) {
    return (
      <div className={`library-container page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!library) {
    return (
      <div className={`library-container page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onAddLibrary={openAddLibraryModal}
          refreshKey={sidebarRefreshKey}
        />
        <div className="error-container">
          <p>라이브러리를 찾을 수 없습니다</p>
          <Link
            to="/"
            className="back-link"
          >
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`library-container page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onAddLibrary={openAddLibraryModal}
        refreshKey={sidebarRefreshKey}
      />

      {/* 라이브러리 추가 모달 */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 className="modal-title">새 라이브러리 추가</h2>
            <form
              onSubmit={handleAddLibrary}
              className="modal-form"
            >
              <div className="form-group">
                <label>이름</label>
                <input
                  type="text"
                  value={newLibName}
                  onChange={(e) => setNewLibName(e.target.value)}
                  placeholder="예: 만화책"
                  required
                />
              </div>
              <div className="form-group">
                <label>경로 (서버 내부 경로)</label>
                <input
                  type="text"
                  value={newLibPath}
                  onChange={(e) => setNewLibPath(e.target.value)}
                  placeholder="예: /mnt/data/comics"
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

      {/* 메인 콘텐츠 */}
      <div className="library-content-wrapper">
        {/* 서브 헤더 (경로 및 뒤로가기 버튼 제거됨) */}
        <div className="sub-header">
          <div className="sub-header-content">
            <div className="sub-header-left">
              <div className="library-title-section">
                <h2 className="library-name">
                  <Folder size={24} /> {library.name}
                </h2>
              </div>
            </div>
            <div className="sub-header-right">
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="scan-btn"
              >
                {isScanning ? (
                  <>
                    <RefreshCw
                      size={16}
                      className="spin"
                    />{" "}
                    스캔 중...
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} /> 스캔
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 시리즈 그리드 */}
        <main className="library-main">
          <div className="series-count">
            총 <strong>{seriesList.length}</strong>개의 시리즈
          </div>

          {seriesList.length === 0 ? (
            <div className="empty-state">
              <p>스캔된 시리즈가 없습니다</p>
              <button
                onClick={handleScan}
                className="scan-btn primary"
              >
                <RefreshCw size={16} /> 지금 스캔하기
              </button>
            </div>
          ) : (
            <div className="series-grid">
              {seriesList.map((series) => (
                <SeriesCard
                  key={series.id}
                  item={series}
                  type="series"
                  progressStyle="overlay"
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
