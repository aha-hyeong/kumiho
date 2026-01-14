import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Settings, ArrowLeft, X } from "lucide-react";
import { useViewerStore } from "../stores/viewerStore";
import { SmartImageViewer } from "../components/SmartImageViewer";
import { chapterAPI, seriesAPI, volumeAPI } from "../api/client";
import "./Viewer.css";

// 타입 정의
interface Chapter {
  id: string;
  volume_id: string;
  title: string;
  chapter_number: number;
  page_count: number;
}

// API 기본 URL
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api/v1";

// 설정 상수
const DEFAULT_PRELOAD_COUNT = 6;
const PROGRESS_SAVE_INTERVAL = 5000; // 5초
const UI_HIDE_DELAY = 3000; // 3초

// 이미지 URL 생성 (토큰 포함)
const getPageImageUrl = (chapterId: string, pageNumber: number): string => {
  const token = localStorage.getItem("access_token");
  let url = `${API_BASE_URL}/chapters/${chapterId}/pages/${pageNumber}/image`;
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }
  return url;
};

export function ViewerPage() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const navigate = useNavigate();

  // 뷰어 스토어
  const {
    currentPage,
    totalPages,
    isUIVisible,
    isSettingsOpen,
    settings,
    setCurrentPage,
    setTotalPages,
    nextPage,
    prevPage,
    goToPage,
    toggleUI,
    showUI,
    toggleSettings,
    closeSettings,
    setReadingMode,
    setReadingDirection,
    setClickDirection,
    togglePageOffset,
    setFitMode,
    setBackgroundColor,
    reset,
  } = useViewerStore();

  // 로컬 상태
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 이미지 로딩 상태: undefined = 미시작, true = 로딩중, false = 완료
  const [imageLoading, setImageLoading] = useState<Record<number, boolean>>({});
  const [showPageJump, setShowPageJump] = useState(false);
  const [jumpValue, setJumpValue] = useState("");

  // UI 자동 숨김 타이머 ref
  const hideTimerRef = useRef<number | null>(null);

  // 진행도 저장 debounce ref
  const saveProgressRef = useRef<number | null>(null);

  // 내부 스크롤에 의한 페이지 변경인지 추적 (세로 모드용)
  const isInternalScrollRef = useRef(false);

  // 챕터 정보 로드
  useEffect(() => {
    if (!chapterId) return;

    const loadChapter = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await chapterAPI.get(chapterId);
        const chapterData = response.data;
        setChapter(chapterData);

        // 볼륨 정보 로드하여 시리즈 ID 획득 (진행도 저장/로드용)
        let loadedSeriesId: string | null = null;
        if (chapterData.volume_id) {
          try {
            const volumeRes = await volumeAPI.get(chapterData.volume_id);
            loadedSeriesId = volumeRes.data.series_id;
            setSeriesId(loadedSeriesId);
          } catch (volumeErr) {
            console.warn("볼륨 정보 로드 실패:", volumeErr);
          }
        }

        // reset()을 먼저 호출 후 상태 설정 (reset이 totalPages를 0으로 초기화하므로)
        reset();
        setTotalPages(chapterData.page_count);

        // 저장된 진행도 불러오기 (현재 챕터와 일치하면 해당 페이지로 이동)
        let startPage = 1;
        if (loadedSeriesId) {
          try {
            const progressRes = await seriesAPI.getProgress(loadedSeriesId);
            // API 응답이 { progress: {...}, series: {...} } 구조
            const progress = progressRes.data.progress;
            console.log("진행도 API 응답:", progress);
            console.log("비교: progress.chapter_id =", progress?.chapter_id, "/ chapterId =", chapterId);

            // 저장된 챕터가 현재 챕터와 같으면 저장된 페이지로 시작
            if (progress && progress.chapter_id === chapterId && progress.current_page > 0) {
              startPage = Math.min(progress.current_page, chapterData.page_count);
              console.log(`진행도 복원: ${startPage}/${chapterData.page_count} 페이지`);
            } else if (progress) {
              console.log("진행도 조건 불일치: chapter_id가 다르거나 current_page가 0");
            } else {
              console.log("저장된 진행도 없음");
            }
          } catch (progressErr: any) {
            // 진행도가 없으면 1페이지부터 시작 (404는 정상)
            if (progressErr?.response?.status === 404) {
              console.log("저장된 진행도 없음, 1페이지부터 시작");
            } else {
              console.warn("진행도 로드 실패:", progressErr?.message || progressErr);
            }
          }
        } else {
          console.log("seriesId 없음, 1페이지부터 시작");
        }
        setCurrentPage(startPage);
      } catch (err) {
        console.error("챕터 로드 실패:", err);
        setError("챕터를 불러올 수 없습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    loadChapter();
  }, [chapterId, setTotalPages, setCurrentPage, reset]);

  // 진행도 저장 (debounce 5초)
  const saveProgress = useCallback(async () => {
    // 초기 로딩 중이거나 필수 데이터가 없으면 저장 안 함
    if (isLoading || !chapterId || !chapter || !seriesId) return;

    try {
      await seriesAPI.updateProgress(seriesId, {
        chapter_id: chapterId,
        current_page: currentPage,
        total_pages: totalPages,
        progress_percent: (currentPage / totalPages) * 100,
      });
      console.log(`진행도 저장: ${currentPage}/${totalPages} 페이지`);
    } catch (err) {
      console.error("진행도 저장 실패:", err);
    }
  }, [isLoading, chapterId, chapter, seriesId, currentPage, totalPages]);

  // 페이지 변경 시 진행도 저장 (debounce)
  useEffect(() => {
    // 초기 로딩 중이면 저장 타이머 설정 안 함
    if (isLoading) return;

    if (saveProgressRef.current) {
      clearTimeout(saveProgressRef.current);
    }

    saveProgressRef.current = window.setTimeout(() => {
      saveProgress();
    }, PROGRESS_SAVE_INTERVAL);

    return () => {
      if (saveProgressRef.current) {
        clearTimeout(saveProgressRef.current);
      }
    };
  }, [currentPage, saveProgress]);

  // beforeunload 시 진행도 저장
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 동기적으로 저장 시도 (beacon API 사용)
      if (seriesId && chapterId) {
        const data = JSON.stringify({
          chapter_id: chapterId,
          current_page: currentPage,
          total_pages: totalPages,
          progress_percent: (currentPage / totalPages) * 100,
        });
        navigator.sendBeacon(
          `${API_BASE_URL}/series/${seriesId}/progress`,
          new Blob([data], { type: "application/json" })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [seriesId, chapterId, currentPage, totalPages]);

  // 키보드 이벤트
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력 중이면 무시
      if (e.target instanceof HTMLInputElement) return;

      const isRTL = settings.readingDirection === "rtl";

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          isRTL ? nextPage() : prevPage();
          break;
        case "ArrowRight":
          e.preventDefault();
          isRTL ? prevPage() : nextPage();
          break;
        case " ":
          e.preventDefault();
          nextPage();
          break;
        case "Home":
          e.preventDefault();
          goToPage(1);
          break;
        case "End":
          e.preventDefault();
          goToPage(totalPages);
          break;
        case "f":
        case "F11":
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
          break;
        case "Escape":
          if (isSettingsOpen) {
            closeSettings();
          } else if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            handleBack();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settings.readingDirection, nextPage, prevPage, goToPage, totalPages, isSettingsOpen, closeSettings]);

  // UI 자동 숨김
  useEffect(() => {
    const resetHideTimer = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }

      if (isUIVisible && !isSettingsOpen) {
        hideTimerRef.current = window.setTimeout(() => {
          useViewerStore.getState().hideUI();
        }, UI_HIDE_DELAY);
      }
    };

    resetHideTimer();

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [isUIVisible, isSettingsOpen, currentPage]);

  // 이미지 프리로딩 - 현재 페이지 주변 이미지를 미리 로드
  useEffect(() => {
    if (!chapter || !chapterId) return;

    const preloadCount = settings.preloadCount || DEFAULT_PRELOAD_COUNT;
    const pagesToPreload: number[] = [];

    // 앞뒤로 preloadCount만큼 프리로드
    for (let i = 1; i <= preloadCount; i++) {
      if (currentPage + i <= totalPages) {
        pagesToPreload.push(currentPage + i);
      }
      if (currentPage - i >= 1) {
        pagesToPreload.push(currentPage - i);
      }
    }

    // 이미지 프리로드 (Image 객체 사용)
    pagesToPreload.forEach((pageNum) => {
      if (imageLoading[pageNum] === undefined) {
        // 로딩 시작 표시
        setImageLoading((prev) => ({ ...prev, [pageNum]: true }));

        const img = new Image();
        img.src = getPageImageUrl(chapter.id, pageNum);
        img.onload = () => {
          setImageLoading((prev) => ({ ...prev, [pageNum]: false }));
        };
      }
    });
  }, [currentPage, totalPages, chapter, chapterId, settings.preloadCount]);

  // 세로 모드 스크롤 동기화 및 관찰
  useEffect(() => {
    if (settings.readingMode !== "vertical") return;

    // 1. 현재 페이지로 스크롤 이동 (외부 요인으로 변경된 경우만)
    if (!isInternalScrollRef.current) {
      const pageEl = document.getElementById(`page-${currentPage}`);
      if (pageEl) {
        // 렌더링 후 스크롤 실행 보장
        requestAnimationFrame(() => {
          pageEl.scrollIntoView({ block: "start" });
        });
      }
    } else {
      // 내부 스크롤 변경이면 플래그 초기화
      isInternalScrollRef.current = false;
    }
  }, [currentPage, settings.readingMode]);

  useEffect(() => {
    if (settings.readingMode !== "vertical") return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 교차된 요소 중 하나만 처리 (가장 첫 번째 or 마지막)
        // rootMargin이 선(-50%)이므로 보통 하나만 걸림
        const intersectingEntry = entries.find((entry) => entry.isIntersecting);
        if (intersectingEntry) {
          const pageNum = parseInt(intersectingEntry.target.id.replace("page-", ""), 10);
          const currentStorePage = useViewerStore.getState().currentPage;

          if (!isNaN(pageNum) && pageNum !== currentStorePage) {
            isInternalScrollRef.current = true; // 스크롤에 의한 변경임을 표시
            setCurrentPage(pageNum);
          }
        }
      },
      {
        rootMargin: "-50% 0px -50% 0px", // 화면 중앙선 교차 감지 (긴 이미지 대응)
        threshold: 0,
      }
    );

    // 모든 페이지 관찰 (효율성 개선: querySelectorAll 사용)
    const pages = document.querySelectorAll(".page-image-wrapper");
    pages.forEach((page) => observer.observe(page));

    return () => observer.disconnect();
  }, [totalPages, settings.readingMode, setCurrentPage]); // isLoading 제거 (React 18 Batching으로 totalPages 변경 시 처리됨)

  // 클릭 핸들러
  const handleZoneClick = (zone: "left" | "center" | "right") => {
    if (zone === "center") {
      toggleUI();
      return;
    }

    const isRTL = settings.clickDirection === "rtl";

    if (zone === "left") {
      isRTL ? nextPage() : prevPage();
    } else {
      isRTL ? prevPage() : nextPage();
    }

    showUI();
  };

  // 뒤로가기
  const handleBack = () => {
    // 진행도 저장 후 이동
    saveProgress();
    navigate(-1);
  };

  // 슬라이더 변경
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const page = parseInt(e.target.value, 10);
    setCurrentPage(page);
  };

  // 페이지 점프
  const handlePageJump = () => {
    const page = parseInt(jumpValue, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      goToPage(page);
    }
    setShowPageJump(false);
    setJumpValue("");
  };

  // 이미지 로드 완료
  const handleImageLoad = (pageNum: number) => {
    setImageLoading((prev) => ({ ...prev, [pageNum]: false }));
  };

  // 표시할 페이지 계산
  const getDisplayPages = (): number[] => {
    if (settings.readingMode === "vertical") {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    if (settings.readingMode === "single") {
      return [currentPage];
    }

    // double 모드
    const offset = settings.pageOffset;

    // 오프셋 1일 때 1페이지는 단독 표시 (표지)
    if (offset === 1 && currentPage === 1) {
      return [1];
    }

    let startPage = currentPage;
    if (offset === 0) {
      // 오프셋 0: (1,2), (3,4) ... 홀수 시작
      if (startPage % 2 === 0) startPage--;
    } else {
      // 오프셋 1: (1), (2,3), (4,5) ... 짝수 시작 (1페이지 제외)
      if (startPage % 2 !== 0) startPage--;
    }

    // 범위 체크
    if (startPage < 1) startPage = 1;

    const pages = [startPage];
    if (startPage + 1 <= totalPages) {
      pages.push(startPage + 1);
    }

    return pages;
  };

  // 로딩/에러 상태
  if (isLoading) {
    return (
      <div
        className="viewer-container"
        style={{ background: settings.backgroundColor }}
      >
        <div className="viewer-content">
          <div className="page-loading">
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !chapter) {
    return (
      <div
        className="viewer-container"
        style={{ background: settings.backgroundColor }}
      >
        <div className="viewer-content">
          <div style={{ color: "white", textAlign: "center" }}>
            <p>{error || "챕터를 찾을 수 없습니다."}</p>
            <button
              onClick={handleBack}
              style={{ marginTop: 16, color: "white" }}
            >
              돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  const displayPages = getDisplayPages();

  return (
    <div
      className="viewer-container"
      style={{ background: settings.backgroundColor }}
    >
      {/* 상단 바 */}
      <header className={`viewer-header ${!isUIVisible ? "hidden" : ""}`}>
        <button
          className="header-back"
          onClick={handleBack}
        >
          <ArrowLeft size={24} />
        </button>
        <div className="header-title">
          {chapter.title} - {currentPage} / {totalPages}
        </div>
        <button
          className="header-settings"
          onClick={toggleSettings}
        >
          <Settings size={24} />
        </button>
      </header>

      {/* 이미지 영역 */}
      <div
        className={`viewer-content mode-${settings.readingMode} direction-${settings.readingDirection}`}
        onClick={(e) => {
          // 세로 모드일 때 배경(빈 공간) 클릭 시에만 UI 토글 (이미지 클릭 제외)
          if (settings.readingMode === "vertical" && e.target === e.currentTarget) {
            toggleUI();
          }
        }}
      >
        {displayPages.map((pageNum, index) => {
          // 두 페이지 모드일 때는 모든 이미지가 로드될 때까지 숨김 처리하여 동시에 표시
          const isDoubleMode = settings.readingMode === "double";
          const allLoaded = displayPages.every((p) => imageLoading[p] === false);
          const shouldHide = isDoubleMode && !allLoaded;

          // 다음 페이지 URL 계산 (프리로딩용)
          // 현재 페이지가 마지막 페이지가 아니면 다음 페이지, 마지막이면 undefined
          // Double view일 경우 2페이지 뒤를 미리 로딩하는 것이 좋을 수 있음
          const nextSrc = pageNum < totalPages ? getPageImageUrl(chapter.id, pageNum + 1) : undefined;

          return (
            <div
              key={index} // 중요: 페이지 번호가 아닌 index를 key로 사용하여 컴포넌트 재생성 방지
              id={`page-${pageNum}`} // 스크롤 이동을 위한 ID 추가
              className="page-image-wrapper"
            >
              <SmartImageViewer
                src={getPageImageUrl(chapter.id, pageNum)}
                nextSrc={nextSrc}
                alt={`페이지 ${pageNum}`}
                className={`page-image fit-${settings.fitMode} ${shouldHide ? "hidden" : ""}`}
                onLoad={() => handleImageLoad(pageNum)}
              />
            </div>
          );
        })}

        {/* 클릭 영역 (세로 모드 제외) */}
        {settings.readingMode !== "vertical" && (
          <div className="click-zones">
            <div
              className="click-zone zone-left"
              onClick={() => handleZoneClick("left")}
            />
            <div
              className="click-zone zone-center"
              onClick={() => handleZoneClick("center")}
            />
            <div
              className="click-zone zone-right"
              onClick={() => handleZoneClick("right")}
            />
          </div>
        )}
      </div>

      {/* 하단 바 */}
      <footer className={`viewer-footer ${!isUIVisible ? "hidden" : ""}`}>
        <div className="footer-controls">
          <button
            className="nav-btn"
            onClick={() => goToPage(1)}
            disabled={currentPage === 1}
          >
            <ChevronsLeft size={20} />
          </button>
          <button
            className="nav-btn"
            onClick={prevPage}
            disabled={currentPage === 1}
          >
            <ChevronLeft size={20} />
          </button>

          <div className="page-slider-container">
            <input
              type="range"
              className="page-slider"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={handleSliderChange}
            />
            <div className="page-info">
              <span
                className="page-info-clickable"
                onClick={() => setShowPageJump(true)}
              >
                {currentPage} / {totalPages}
              </span>
            </div>
          </div>

          <button
            className="nav-btn"
            onClick={nextPage}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight size={20} />
          </button>
          <button
            className="nav-btn"
            onClick={() => goToPage(totalPages)}
            disabled={currentPage >= totalPages}
          >
            <ChevronsRight size={20} />
          </button>

          {/* 토글 버튼 (태블릿/데스크탑) */}
          <div className="footer-toggles">
            <button
              className={`toggle-btn ${settings.readingMode === "double" ? "active" : ""}`}
              onClick={() => setReadingMode(settings.readingMode === "single" ? "double" : "single")}
            >
              {settings.readingMode === "double" ? "2페이지" : "1페이지"}
            </button>
            <button
              className={`toggle-btn ${settings.pageOffset === 1 ? "active" : ""}`}
              onClick={togglePageOffset}
            >
              오프셋 {settings.pageOffset === 1 ? "+1" : "0"}
            </button>
          </div>
        </div>
      </footer>

      {/* 설정 패널 */}
      {isSettingsOpen && (
        <div
          className="settings-overlay"
          onClick={closeSettings}
        >
          <div
            className="settings-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-header">
              <span className="settings-title">⚙️ 읽기 설정</span>
              <button
                className="settings-close"
                onClick={closeSettings}
              >
                <X size={20} />
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-label">보기 모드</div>
              <div className="settings-options">
                <button
                  className={`option-btn ${settings.readingMode === "single" ? "selected" : ""}`}
                  onClick={() => setReadingMode("single")}
                >
                  한 페이지
                </button>
                <button
                  className={`option-btn ${settings.readingMode === "double" ? "selected" : ""}`}
                  onClick={() => setReadingMode("double")}
                >
                  두 페이지
                </button>
                <button
                  className={`option-btn ${settings.readingMode === "vertical" ? "selected" : ""}`}
                  onClick={() => setReadingMode("vertical")}
                >
                  세로 스크롤
                </button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-label">읽기 방향</div>
              <div className="settings-options">
                <button
                  className={`option-btn ${settings.readingDirection === "ltr" ? "selected" : ""}`}
                  onClick={() => setReadingDirection("ltr")}
                >
                  좌→우
                </button>
                <button
                  className={`option-btn ${settings.readingDirection === "rtl" ? "selected" : ""}`}
                  onClick={() => setReadingDirection("rtl")}
                >
                  우→좌
                </button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-label">클릭 방향</div>
              <div className="settings-options">
                <button
                  className={`option-btn ${settings.clickDirection === "ltr" ? "selected" : ""}`}
                  onClick={() => setClickDirection("ltr")}
                >
                  좌→우
                </button>
                <button
                  className={`option-btn ${settings.clickDirection === "rtl" ? "selected" : ""}`}
                  onClick={() => setClickDirection("rtl")}
                >
                  우→좌
                </button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-label">이미지 맞춤</div>
              <div className="settings-options">
                <button
                  className={`option-btn ${settings.fitMode === "screen" ? "selected" : ""}`}
                  onClick={() => setFitMode("screen")}
                >
                  화면
                </button>
                <button
                  className={`option-btn ${settings.fitMode === "width" ? "selected" : ""}`}
                  onClick={() => setFitMode("width")}
                >
                  폭
                </button>
                <button
                  className={`option-btn ${settings.fitMode === "height" ? "selected" : ""}`}
                  onClick={() => setFitMode("height")}
                >
                  높이
                </button>
                <button
                  className={`option-btn ${settings.fitMode === "original" ? "selected" : ""}`}
                  onClick={() => setFitMode("original")}
                >
                  원본
                </button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-label">배경색</div>
              <div className="color-options">
                <button
                  className={`color-btn ${settings.backgroundColor === "#000000" ? "selected" : ""}`}
                  style={{ background: "#000000" }}
                  onClick={() => setBackgroundColor("#000000")}
                />
                <button
                  className={`color-btn ${settings.backgroundColor === "#1a1a1a" ? "selected" : ""}`}
                  style={{ background: "#1a1a1a" }}
                  onClick={() => setBackgroundColor("#1a1a1a")}
                />
                <button
                  className={`color-btn ${settings.backgroundColor === "#333333" ? "selected" : ""}`}
                  style={{ background: "#333333" }}
                  onClick={() => setBackgroundColor("#333333")}
                />
                <button
                  className={`color-btn ${settings.backgroundColor === "#ffffff" ? "selected" : ""}`}
                  style={{ background: "#ffffff", border: "1px solid #ccc" }}
                  onClick={() => setBackgroundColor("#ffffff")}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 페이지 점프 모달 */}
      {showPageJump && (
        <div
          className="settings-overlay"
          onClick={() => setShowPageJump(false)}
        >
          <div
            className="page-jump-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div>페이지 이동</div>
            <input
              type="number"
              className="page-jump-input"
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePageJump()}
              placeholder={`1-${totalPages}`}
              min={1}
              max={totalPages}
              autoFocus
            />
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Enter로 이동</div>
          </div>
        </div>
      )}
    </div>
  );
}
