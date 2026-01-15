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

  // 다음/이전 챕터 정보
  const [nextChapterId, setNextChapterId] = useState<string | null>(null);
  const [prevChapterId, setPrevChapterId] = useState<string | null>(null);
  const [nextChapterTitle, setNextChapterTitle] = useState<string | null>(null);
  const [prevChapterTitle, setPrevChapterTitle] = useState<string | null>(null);
  const [showNextHint, setShowNextHint] = useState(false);
  const [showPrevHint, setShowPrevHint] = useState(false);

  // UI 자동 숨김 타이머 ref
  const hideTimerRef = useRef<number | null>(null);

  // 진행도 저장 debounce ref
  const saveProgressRef = useRef<number | null>(null);

  // 내부 스크롤에 의한 페이지 변경인지 추적 (세로 모드용)
  const isInternalScrollRef = useRef(false);

  // 세로 스크롤 당기기 네비게이션 상태
  const [pullOffset, setPullOffset] = useState(0); // 음수: 위로 당김, 양수: 아래로 당김
  const isNavigatingRef = useRef(false); // 중복 이동 방지
  const viewerContentRef = useRef<HTMLDivElement>(null);

  // 챕터 정보 로드
  useEffect(() => {
    if (!chapterId) return;

    const loadChapter = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setShowNextHint(false);
        setShowPrevHint(false);

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

            // 인접 챕터 로드 (비동기)
            if (loadedSeriesId) {
              loadAdjacentChapters(chapterData.volume_id, chapterData.id, loadedSeriesId);
            }
          } catch (volumeErr) {
            console.warn("볼륨 정보 로드 실패:", volumeErr);
          }
        }

        // reset()을 먼저 호출 후 상태 설정 (reset이 totalPages를 0으로 초기화하므로)
        reset();
        setTotalPages(chapterData.page_count);

        // 저장된 진행도 불러오기 (현재 챕터의 진행도 직접 조회)
        let startPage = 1;
        try {
          const progressRes = await chapterAPI.getProgress(chapterId);
          const progress = progressRes.data.progress;

          // 저장된 진행도가 있으면 해당 페이지로 시작
          if (progress && progress.current_page > 0) {
            startPage = Math.min(progress.current_page, chapterData.page_count);
          }
        } catch (progressErr: any) {
          // 진행도가 없으면 1페이지부터 시작 (404는 정상)
          if (progressErr?.response?.status !== 404) {
            console.warn("진행도 로드 실패:", progressErr?.message || progressErr);
          }
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

  // 인접 챕터 정보 로드
  const loadAdjacentChapters = async (volumeId: string, currentChapterId: string, seriesId: string) => {
    try {
      // 1. 현재 볼륨의 챕터 목록 조회
      const chaptersRes = await volumeAPI.getChapters(volumeId);
      const chapters = chaptersRes.data.chapters.sort((a: any, b: any) => a.chapter_number - b.chapter_number);
      const currentIndex = chapters.findIndex((c: any) => c.id === currentChapterId);

      // 같은 볼륨 내 이전/다음 챕터 확인
      if (currentIndex > 0) {
        const prev = chapters[currentIndex - 1];
        setPrevChapterId(prev.id);
        setPrevChapterTitle(prev.title);
      } else {
        // 볼륨의 첫 챕터 -> 이전 볼륨 확인
        setPrevChapterId(null);
        setPrevChapterTitle(null);
        fetchAdjacentVolumeChapter(seriesId, volumeId, "prev");
      }

      if (currentIndex < chapters.length - 1) {
        const next = chapters[currentIndex + 1];
        setNextChapterId(next.id);
        setNextChapterTitle(next.title);
      } else {
        // 볼륨의 마지막 챕터 -> 다음 볼륨 확인
        setNextChapterId(null);
        setNextChapterTitle(null);
        fetchAdjacentVolumeChapter(seriesId, volumeId, "next");
      }
    } catch (err) {
      console.error("인접 챕터 로드 실패:", err);
    }
  };

  // 인접 볼륨의 챕터 찾기
  const fetchAdjacentVolumeChapter = async (seriesId: string, currentVolumeId: string, direction: "next" | "prev") => {
    try {
      const volumesRes = await seriesAPI.getVolumes(seriesId);
      const volumes = volumesRes.data.volumes.sort((a: any, b: any) => a.volume_number - b.volume_number);
      const currentVolIndex = volumes.findIndex((v: any) => v.id === currentVolumeId);

      if (direction === "prev") {
        if (currentVolIndex > 0) {
          const prevVol = volumes[currentVolIndex - 1];
          // 이전 볼륨의 마지막 챕터 가져오기
          const chaptersRes = await volumeAPI.getChapters(prevVol.id);
          const chapters = chaptersRes.data.chapters.sort((a: any, b: any) => a.chapter_number - b.chapter_number);
          if (chapters.length > 0) {
            const lastChapter = chapters[chapters.length - 1];
            setPrevChapterId(lastChapter.id);
            // 볼륨 제목과 챕터 제목이 같으면 챕터 제목만 표시
            const title =
              prevVol.title !== lastChapter.title ? `${prevVol.title} - ${lastChapter.title}` : lastChapter.title;
            setPrevChapterTitle(title);
          }
        }
      } else {
        if (currentVolIndex < volumes.length - 1) {
          const nextVol = volumes[currentVolIndex + 1];
          // 다음 볼륨의 첫 챕터 가져오기
          const chaptersRes = await volumeAPI.getChapters(nextVol.id);
          const chapters = chaptersRes.data.chapters.sort((a: any, b: any) => a.chapter_number - b.chapter_number);
          if (chapters.length > 0) {
            const firstChapter = chapters[0];
            setNextChapterId(firstChapter.id);
            // 볼륨 제목과 챕터 제목이 같으면 챕터 제목만 표시
            const title =
              nextVol.title !== firstChapter.title ? `${nextVol.title} - ${firstChapter.title}` : firstChapter.title;
            setNextChapterTitle(title);
          }
        }
      }
    } catch (err) {
      console.warn(`인접 볼륨(${direction}) 로드 실패:`, err);
    }
  };

  // 진행도 저장 (debounce 5초)
  const saveProgress = useCallback(async () => {
    // 초기 로딩 중이거나 필수 데이터가 없으면 저장 안 함
    if (isLoading || !chapterId || !chapter || !seriesId) return;

    try {
      await seriesAPI.updateProgress(seriesId, {
        chapter_id: chapterId,
        volume_id: chapter.volume_id,
        current_page: currentPage,
        total_pages: totalPages,
        progress_percent: totalPages > 0 ? (currentPage / totalPages) * 100 : 0,
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
      // 페이지 종료 시 진행도 저장 (fetch + keepalive + credentials 사용)
      // sendBeacon은 커스텀 헤더를 지원하지 않지만, fetch + keepalive는 쿠키와 함께 사용 가능
      if (seriesId && chapterId) {
        const data = JSON.stringify({
          chapter_id: chapterId,
          volume_id: chapter?.volume_id,
          current_page: currentPage,
          total_pages: totalPages,
          progress_percent: totalPages > 0 ? (currentPage / totalPages) * 100 : 0,
        });

        fetch(`${API_BASE_URL}/series/${seriesId}/progress`, {
          method: "PATCH",
          body: data,
          headers: { "Content-Type": "application/json" },
          credentials: "include", // 쿠키 자동 전송
          keepalive: true, // 페이지 종료 후에도 요청 완료
        }).catch((err) => console.error("Progress save failed:", err));
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [seriesId, chapterId, currentPage, totalPages, chapter]);

  // 다음 페이지/챕터 핸들러
  const handleNext = useCallback(() => {
    if (currentPage < totalPages) {
      nextPage();
    } else {
      // 마지막 페이지
      if (showNextHint && nextChapterId) {
        // 이미 힌트가 떠있으면 이동
        navigate(`/viewer/${nextChapterId}`);
      } else if (nextChapterId) {
        // 힌트 표시
        setShowNextHint(true);
        // 3초 후 힌트 사라짐
        setTimeout(() => setShowNextHint(false), 3000);
      } else {
        // 다음 챕터 없음 (마지막 권) - 마지막 권 안내는 추후 구현
      }
    }
  }, [currentPage, totalPages, nextPage, showNextHint, nextChapterId, navigate]);

  // 이전 페이지/챕터 핸들러
  const handlePrev = useCallback(() => {
    if (currentPage > 1) {
      prevPage();
    } else {
      // 첫 페이지
      if (showPrevHint && prevChapterId) {
        navigate(`/viewer/${prevChapterId}`);
      } else if (prevChapterId) {
        setShowPrevHint(true);
        setTimeout(() => setShowPrevHint(false), 3000);
      }
    }
  }, [currentPage, prevPage, showPrevHint, prevChapterId, navigate]);

  // 키보드 이벤트
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력 중이면 무시
      if (e.target instanceof HTMLInputElement) return;

      const isRTL = settings.readingDirection === "rtl";

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          isRTL ? handleNext() : handlePrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          isRTL ? handlePrev() : handleNext();
          break;
        case " ":
          e.preventDefault();
          handleNext();
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
  }, [settings.readingDirection, handleNext, handlePrev, goToPage, totalPages, isSettingsOpen, closeSettings]);

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

  // 세로 스크롤 모드: 오버스크롤 감지 (당기기 네비게이션)
  useEffect(() => {
    if (settings.readingMode !== "vertical" || isLoading) return;

    const content = viewerContentRef.current;
    if (!content) return;

    const PULL_THRESHOLD = 120; // 이동 트리거 임계값 (높을수록 둔감)
    const PULL_SENSITIVITY = 0.5; // 당김 민감도 (낮을수록 둔감)
    const SHOW_THRESHOLD = 10; // UI 표시 최소 임계값

    const handleWheel = (e: WheelEvent) => {
      if (isNavigatingRef.current) return;

      const isAtTop = content.scrollTop <= 0;
      const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;

      // 맨 위에서 위로 스크롤 (이전 챕터)
      if (isAtTop && e.deltaY < 0 && prevChapterId) {
        e.preventDefault();
        setPullOffset((prev) => {
          const newOffset = Math.min(0, prev + e.deltaY * PULL_SENSITIVITY);
          // 임계값 도달 시 이동
          if (Math.abs(newOffset) >= PULL_THRESHOLD) {
            isNavigatingRef.current = true;
            navigate(`/viewer/${prevChapterId}`);
            return 0;
          }
          return newOffset;
        });
      }
      // 맨 아래에서 아래로 스크롤 (다음 챕터)
      else if (isAtBottom && e.deltaY > 0 && nextChapterId) {
        e.preventDefault();
        setPullOffset((prev) => {
          const newOffset = Math.max(0, prev + e.deltaY * PULL_SENSITIVITY);
          if (newOffset >= PULL_THRESHOLD) {
            isNavigatingRef.current = true;
            navigate(`/viewer/${nextChapterId}`);
            return 0;
          }
          return newOffset;
        });
      }
      // 일반 스크롤 중이면 pullOffset 초기화
      else {
        setPullOffset(0);
      }
    };

    // pullOffset 감쇠 (스크롤 멈추면 서서히 복귀)
    const decayInterval = setInterval(() => {
      setPullOffset((prev) => {
        if (Math.abs(prev) < SHOW_THRESHOLD) return 0;
        return prev * 0.96; // 4% 씩 감쇠 (더 느리게)
      });
    }, 50);

    content.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      content.removeEventListener("wheel", handleWheel);
      clearInterval(decayInterval);
      isNavigatingRef.current = false;
    };
  }, [settings.readingMode, prevChapterId, nextChapterId, navigate, isLoading]);

  // 클릭 핸들러
  const handleZoneClick = (zone: "left" | "center" | "right") => {
    if (zone === "center") {
      toggleUI();
      return;
    }

    const isRTL = settings.clickDirection === "rtl";

    if (zone === "left") {
      isRTL ? handleNext() : handlePrev();
    } else {
      isRTL ? handlePrev() : handleNext();
    }

    // UI가 숨겨져 있을 때만 보이게 하기 (선택사항)
    // showUI();
  };

  // 뒤로가기
  const handleBack = () => {
    // 진행도 저장 후 이동
    saveProgress();
    if (seriesId) {
      navigate(`/series/${seriesId}`);
    } else {
      navigate(-1);
    }
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
        ref={viewerContentRef}
        className={`viewer-content mode-${settings.readingMode} direction-${settings.readingDirection}`}
        onClick={(e) => {
          // 세로 모드일 때 클릭 시 UI 토글 (네비게이션 영역 제외)
          if (settings.readingMode === "vertical") {
            const target = e.target as HTMLElement;
            // 네비게이션 영역 클릭은 무시 (이미 별도 onClick 핸들러 있음)
            if (!target.closest(".vertical-chapter-nav")) {
              toggleUI();
            }
          }
        }}
      >
        {/* 세로 모드: 이전 챕터 네비게이션 (당김 시에만 표시) */}
        {settings.readingMode === "vertical" && pullOffset < -20 && prevChapterId && (
          <div
            className="vertical-chapter-nav prev pull-indicator"
            style={{
              transform: `translateY(${Math.min(0, pullOffset + 180)}px)`,
              opacity: Math.min(1, Math.abs(pullOffset) / 80),
            }}
            onClick={() => navigate(`/viewer/${prevChapterId}`)}
          >
            <div className="vertical-chapter-nav-content">
              <span className="vertical-chapter-nav-label">
                ▲ 이전 ({Math.round((Math.abs(pullOffset) / 180) * 100)}%)
              </span>
              <span className="vertical-chapter-nav-title">{prevChapterTitle}</span>
              <span className="vertical-chapter-nav-hint">계속 위로 스크롤하면 이동</span>
            </div>
          </div>
        )}

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

        {/* 클릭 영역 - 모든 모드에서 적용 */}
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

        {/* 세로 모드: 다음 챕터 네비게이션 (당김 시에만 표시) */}
        {settings.readingMode === "vertical" && pullOffset > 10 && nextChapterId && (
          <div
            className="vertical-chapter-nav next pull-indicator"
            style={{
              opacity: Math.min(1, pullOffset / 80),
            }}
            onClick={() => navigate(`/viewer/${nextChapterId}`)}
          >
            <div className="vertical-chapter-nav-content">
              <span className="vertical-chapter-nav-label">▼ 다음 ({Math.round((pullOffset / 150) * 100)}%)</span>
              <span className="vertical-chapter-nav-title">{nextChapterTitle}</span>
              <span className="vertical-chapter-nav-hint">계속 아래로 스크롤하면 이동</span>
            </div>
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
            onClick={handleNext}
            disabled={currentPage >= totalPages && !nextChapterId}
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
              autoFocus
            />
          </div>
        </div>
      )}

      {/* 다음 챕터 이동 힌트 */}
      {showNextHint && nextChapterTitle && (
        <div className="chapter-overlay next">
          <div className="chapter-overlay-content">
            <span className="chapter-overlay-label">다음:</span>
            <span className="chapter-overlay-title">{nextChapterTitle}</span>
            <span className="chapter-overlay-desc">한 번 더 누르면 이동합니다</span>
          </div>
        </div>
      )}

      {/* 이전 챕터 이동 힌트 */}
      {showPrevHint && prevChapterTitle && (
        <div className="chapter-overlay prev">
          <div className="chapter-overlay-content">
            <span className="chapter-overlay-label">이전:</span>
            <span className="chapter-overlay-title">{prevChapterTitle}</span>
            <span className="chapter-overlay-desc">한 번 더 누르면 이동합니다</span>
          </div>
        </div>
      )}
    </div>
  );
}
