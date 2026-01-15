import { useEffect, useState } from "react";
import { BookOpen, Clock, Plus } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { libraryAPI, progressAPI } from "../api/client";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard, type Series } from "../components/SeriesCard";
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
  thumbnail_url?: string;
  volume_id?: string;
  volume_number?: number;
  volume_title?: string;
  chapter_id?: string;
  chapter_number?: number;
  chapter_title?: string;
}

export function HomePage() {
  const user = useAuthStore((state) => state.user);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [recentProgress, setRecentProgress] = useState<RecentProgress[]>([]);
  const [updatedSeries, setUpdatedSeries] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [libRes, progressRes] = await Promise.all([libraryAPI.getAll(), progressAPI.getRecent(10)]);
      const libs = libRes.data.libraries || [];
      setLibraries(libs);
      setRecentProgress(progressRes.data.recent_progress || []);

      // 모든 라이브러리의 시리즈를 합쳐서 최신순으로 정렬
      if (libs.length > 0) {
        const allSeriesPromises = libs.map((lib: Library) => libraryAPI.getSeries(lib.id));
        const seriesResponses = await Promise.all(allSeriesPromises);

        const allSeries: Series[] = [];
        seriesResponses.forEach((res) => {
          const series = (res.data.series || []) as Series[];
          allSeries.push(...series);
        });

        // updated_at 기준 최신순 정렬
        allSeries.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        setUpdatedSeries(allSeries);
      } else {
        setUpdatedSeries([]);
      }
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

      // 5. 메인 데이터 새로고침
      await loadData();
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
      <div className="home-container">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>로딩 중...</p>
        </div>
      </div>
    );
  }

  // 라이브러리가 없는 경우
  if (libraries.length === 0) {
    return (
      <div className={`home-container page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onAddLibrary={openAddLibraryModal}
          refreshKey={sidebarRefreshKey}
        />

        <main className="home-main">
          <div className="empty-library-state">
            <img
              src="/Empty-library.png"
              alt="빈 라이브러리"
              className="empty-library-image"
            />
            <h2>라이브러리가 비어있어요</h2>
            {user?.role === "MASTER" && (
              <button
                onClick={() => setShowAddModal(true)}
                className="add-library-btn-large"
              >
                <Plus size={20} /> 라이브러리 추가하기
              </button>
            )}
          </div>
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
                    placeholder="예: /mnt/media/comics"
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

  // 라이브러리가 있는 경우
  return (
    <div className={`home-container page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onAddLibrary={openAddLibraryModal}
        refreshKey={sidebarRefreshKey}
      />

      <main className="home-main">
        {/* 계속 읽기 섹션 */}
        <section className="section">
          <h2 className="section-title">
            <BookOpen size={20} /> 계속 읽기
          </h2>
          {recentProgress.length === 0 ? (
            <div className="empty-section">
              <p>아직 읽은 책이 없어요</p>
              <p className="empty-hint">라이브러리에서 책을 선택해서 읽어보세요!</p>
            </div>
          ) : (
            <div className="series-grid">
              {recentProgress.map((progress) => {
                // RecentProgress를 Series 객체로 변환
                const seriesData: Series = {
                  id: progress.series_id,
                  title: progress.series_title,
                  library_id: "", // 필수지만 카드에서 사용 안 함
                  created_at: "", // 필수지만 카드에서 사용 안 함
                  updated_at: progress.updated_at,
                  thumbnail_url: progress.thumbnail_url,
                };

                // 진행도 텍스트 생성
                // 1. 권 정보가 있으면 "X권"만 표시 (화 정보 제외)
                // 2. 권 정보가 없고 챕터만 있으면 "X화" 표시
                // 3. 둘 다 없으면 "X페이지" 표시
                let subtitle = "";
                if (progress.volume_id) {
                  subtitle = `${progress.volume_number}권`;
                } else if (progress.chapter_id) {
                  subtitle = `${progress.chapter_number}화`;
                } else {
                  subtitle = `${progress.current_page}페이지`;
                }

                return (
                  <SeriesCard
                    key={progress.id}
                    series={seriesData}
                    customSubtitle={subtitle}
                    progress={progress.progress_percent}
                    chapterId={progress.chapter_id}
                    currentPage={progress.current_page}
                    volumeId={progress.volume_id}
                    onStatusChange={loadData}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* 업데이트된 시리즈 섹션 */}
        <section className="section">
          <h2 className="section-title">
            <Clock size={20} /> 업데이트된 시리즈
          </h2>
          {updatedSeries.length === 0 ? (
            <div className="empty-section">
              <p>최근 업데이트된 시리즈가 없어요</p>
            </div>
          ) : (
            <div className="series-grid">
              {updatedSeries.map((series) => (
                <SeriesCard
                  key={series.id}
                  series={series}
                />
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
                  placeholder="예: /mnt/media/comics"
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
