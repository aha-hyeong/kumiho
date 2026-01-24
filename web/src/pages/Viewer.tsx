import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Settings,
  ArrowLeft,
  Maximize,
  Minimize,
  Shield,
  Music,
} from "lucide-react";
import { useViewerStore } from "../stores/viewerStore";
import type { ViewerSettings, ReadingMode, ReadingDirection, FitMode } from "../stores/viewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import { SmartImageViewer } from "../components/SmartImageViewer";
import { ViewerSettings as ViewerSettingsModal } from "../components/viewer/ViewerSettings";
import { chapterAPI, libraryAPI, seriesAPI, volumeAPI, settingAPI } from "../api/client";
import styles from "./Viewer.module.css";

// 타입 정의
interface Chapter {
  id: string;
  volume_id: string;
  title: string;
  chapter_number: number;
  page_count: number;
}

// 페이지 메타데이터 (두 페이지 모드용)
interface PageMeta {
  pageNumber: number;
  width: number;
  height: number;
  isWide: boolean; // width > height * 1.3
}

// API 기본 URL
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api/v1";

// 설정 상수
const PROGRESS_SAVE_INTERVAL = 0; // 5초
const UI_HIDE_DELAY = 2000; // 2초
const WIDE_RATIO_THRESHOLD = 1.3; // wide 페이지 판단 기준 (가로 / 세로)

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
  const [searchParams] = useSearchParams();
  const urlPage = searchParams.get("page");

  // 뷰어 스토어
  const {
    currentPage,
    totalPages,
    isUIVisible,
    isSettingsOpen,
    isFullscreen,
    settings,
    seriesSettings,
    setCurrentSeriesId,
    initializeSettings,
    setCurrentPage,
    setTotalPages,
    goToPage,
    toggleUI,
    toggleSettings,
    closeSettings,
    setFullscreen,
    setReadingMode,
    togglePageOffset,
    initPage,
    isIncognito,
  } = useViewerStore();

  // 로컬 상태
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 이미지 로딩 상태: undefined = 미시작, true = 로딩중, false = 완료
  const [imageLoading, setImageLoading] = useState<Record<number, boolean>>({});
  // 페이지 메타데이터 (두 페이지 모드에서 wide 페이지 감지용)
  const [pageMeta, setPageMeta] = useState<PageMeta[]>([]);
  // 페이지 메타데이터 Map (O(1) 조회용)
  const pageMetaMap = useMemo(() => new Map(pageMeta.map((p) => [p.pageNumber, p])), [pageMeta]);
  const [showPageJump, setShowPageJump] = useState(false);
  const [jumpValue, setJumpValue] = useState("");

  // 다음/이전 챕터 정보
  const [nextChapterId, setNextChapterId] = useState<string | null>(null);
  const [prevChapterId, setPrevChapterId] = useState<string | null>(null);
  const [nextChapterTitle, setNextChapterTitle] = useState<string | null>(null);
  const [prevChapterTitle, setPrevChapterTitle] = useState<string | null>(null);
  const [showNextHint, setShowNextHint] = useState(false);
  const [showPrevHint, setShowPrevHint] = useState(false);
  // 현재 챕터가 볼륨의 마지막 챕터인지 (완료 처리용)
  const [isLastChapterOfVolume, setIsLastChapterOfVolume] = useState(false);
  const volumeCompletedRef = useRef(false); // 중복 완료 방지

  // BGM 상태
  const [bgmInfo, setBgmInfo] = useState<{ exists: boolean; url?: string } | null>(null);
  const [isBgmPlaying, setIsBgmPlaying] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeIdRef = useRef<string | null>(null);

  // 브라우저 전체화면 상태와 스토어 동기화
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isActuallyFullscreen = isDocumentFullscreen();
      if (isFullscreen !== isActuallyFullscreen) {
        setFullscreen(isActuallyFullscreen);
      }
    };

    const events = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
    events.forEach((event) => document.addEventListener(event, handleFullscreenChange));

    return () => {
      events.forEach((event) => document.removeEventListener(event, handleFullscreenChange));
    };
  }, [isFullscreen, setFullscreen]);

  // 전체화면 토글 핸들러
  const handleToggleFullscreen = useCallback(() => {
    try {
      if (!isDocumentFullscreen()) {
        enterFullscreen().catch(() => {});
      } else {
        exitFullscreen().catch(() => {});
      }
    } catch (err) {
      console.error("Fullscreen toggle failed:", err);
    }
  }, []);

  // 뷰어 종료 시 전체화면 해제
  useEffect(() => {
    return () => {
      if (isDocumentFullscreen()) {
        exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // UI 자동 숨김 타이머 ref
  const hideTimerRef = useRef<number | null>(null);

  // 내부 스크롤에 의한 페이지 변경인지 추적 (세로 모드용)
  const isInternalScrollRef = useRef(false);
  const isInitialScrollingRef = useRef(false); // 초기 정렬 중임을 표시

  // 세로 스크롤 당기기 네비게이션 상태
  const [pullOffset, setPullOffset] = useState(0); // 음수: 위로 당김, 양수: 아래로 당김
  const isNavigatingRef = useRef(false); // 중복 이동 방지
  const viewerContentRef = useRef<HTMLDivElement>(null);

  // 시리즈 ID 관리 및 설정 초기화 (언마운트 시 초기화)
  useEffect(() => {
    return () => {
      setCurrentSeriesId(null);
    };
  }, [setCurrentSeriesId]);

  // 챕터 정보 로드
  useEffect(() => {
    if (!chapterId) return;

    const loadChapter = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setChapter(null); // 이전 챕터 데이터 초기화 (중요)
        setShowNextHint(false);
        setShowPrevHint(false);
        volumeCompletedRef.current = false; // 챕터 변경 시 완료 상태 리셋

        // 스크롤 위치 초기화 (유령 스크롤 방지용 - 챕터 전환 시 필수)
        if (viewerContentRef.current) {
          viewerContentRef.current.scrollTop = 0;
        }

        // 1. 챕터 정보 먼저 가져오기
        const response = await chapterAPI.get(chapterId);
        const chapterData = response.data;

        // 볼륨 ID 변경 확인 및 BGM 로드 (한 볼륨 내에서는 유지)
        if (chapterData.volume_id && chapterData.volume_id !== volumeIdRef.current) {
          volumeIdRef.current = chapterData.volume_id;
          volumeAPI
            .getBGM(chapterData.volume_id)
            .then((res) => setBgmInfo(res.data))
            .catch((err) => console.warn("Failed to load BGM info:", err));
        }

        // 2. 진행도 정보도 미리 가져오기
        let startPage = 1;
        if (urlPage) {
          if (urlPage === "last") {
            startPage = chapterData.page_count;
          } else {
            const parsedPage = parseInt(urlPage, 10);
            if (!isNaN(parsedPage)) {
              startPage = Math.max(1, Math.min(parsedPage, chapterData.page_count));
            }
          }
        } else {
          try {
            const progressRes = await chapterAPI.getProgress(chapterId);
            const progress = progressRes.data.progress;

            // 저장된 진행도가 있으면 해당 페이지로 시작 (백엔드 보정된 값 포함)
            if (progress && progress.current_page > 0) {
              startPage = Math.min(progress.current_page, chapterData.page_count);
            }
          } catch (progressErr: any) {
            if (progressErr?.response?.status !== 404) {
              console.warn("진행도 로드 실패:", progressErr?.message || progressErr);
            }
          }
        }

        // 볼륨 정보 로드
        if (chapterData.volume_id) {
          try {
            const volumeRes = await volumeAPI.get(chapterData.volume_id);
            const loadedSeriesId = volumeRes.data.series_id;
            setSeriesId(loadedSeriesId);
            if (loadedSeriesId) {
              loadAdjacentChapters(chapterData.volume_id, chapterData.id, loadedSeriesId);

              // 설정 우선순위 적용: 시리즈 개별 설정 > 라이브러리 기본값 > 전역 기본값
              try {
                // 완독된 볼륨이면 마지막 페이지로 설정 (단, 1페이지가 아닌 경우, URL 페이지 지정이 없는 경우)
                if (volumeRes.data.is_completed && !urlPage && startPage === 1) {
                  startPage = chapterData.page_count;
                }

                // 1. 전역 기본값 로드
                const globalRes = await settingAPI.list();
                const globalData = (globalRes || {}) as Record<string, string>;

                // 2. 시리즈 정보 로드 (LibraryID 획득을 위해)
                const seriesRes = await seriesAPI.get(loadedSeriesId);
                const seriesData = seriesRes.data;

                // 3. 라이브러리 기본값 로드
                const libRes = await libraryAPI.get(seriesData.library_id);
                const library = libRes.data;

                // 4. 시리즈 개별 설정 로드 (서버 최우선)
                let seriesOverride: Partial<ViewerSettings> = {};
                try {
                  const serverSeriesSettings = await seriesAPI.getViewerSettings(loadedSeriesId);
                  if (serverSeriesSettings && Object.keys(serverSeriesSettings).length > 0) {
                    // 서버 응답(snake_case)을 스토어 형식(camelCase)으로 매핑
                    const mapping: Record<string, keyof ViewerSettings> = {
                      reading_mode: "readingMode",
                      reading_direction: "readingDirection",
                      click_direction: "clickDirection",
                      keyboard_direction: "keyboardDirection",
                      fit_mode: "fitMode",
                      background_color: "backgroundColor",
                      preload_count: "preloadCount",
                      pull_threshold: "pullThreshold",
                      pull_sensitivity: "pullSensitivity",
                      show_threshold: "showThreshold",
                    };

                    Object.entries(serverSeriesSettings).forEach(([key, value]) => {
                      const camelKey = mapping[key];
                      if (camelKey && value !== undefined && value !== null) {
                        (seriesOverride as any)[camelKey] = value;
                      }
                    });
                  }
                } catch (err) {
                  console.warn("시리즈 개별 설정 서버 로드 실패, 로컬 설정을 사용합니다:", err);
                }

                // 5. 계층별 병합 (Global < Library < Series)
                const resolvedSettings: Partial<ViewerSettings> = {};

                // 보기 모드: 시리즈 오버라이드 > 라이브러리 기본값 > 유저 전역 설정 > 전역 기본값(single)
                resolvedSettings.readingMode = (seriesOverride.readingMode ||
                  library.default_view_mode ||
                  globalData.viewer_reading_mode ||
                  "single") as ReadingMode;

                // 읽기 방향: 시리즈 오버라이드 > 라이브러리 기본값 > 유저 전역 설정 > 전역 기본값(ltr)
                resolvedSettings.readingDirection = (seriesOverride.readingDirection ||
                  library.default_read_direction ||
                  globalData.viewer_reading_direction ||
                  "ltr") as ReadingDirection;

                // 클릭 방향: 시리즈 오버라이드 > 전역 클릭 설정 > 전역 읽기 설정 > 기본값(ltr)
                resolvedSettings.clickDirection = (seriesOverride.clickDirection ||
                  globalData.viewer_click_direction ||
                  globalData.viewer_reading_direction ||
                  "ltr") as ReadingDirection;

                // 키보드 방향: 시리즈 오버라이드 > 전역 설정 > 기본값(ltr)
                resolvedSettings.keyboardDirection = (seriesOverride.keyboardDirection ||
                  globalData.viewer_keyboard_direction ||
                  "ltr") as ReadingDirection;

                // 이미지 맞춤 모드: 시리즈 오버라이드 > 유저 전역 설정 > 전역 기본값(screen)
                resolvedSettings.fitMode = (seriesOverride.fitMode ||
                  globalData.viewer_fit_mode ||
                  "screen") as FitMode;

                // 배경색: 시리즈 오버라이드 > 기본값(#000000)
                resolvedSettings.backgroundColor = seriesOverride.backgroundColor || "#000000";

                // 고급 설정 (전역 설정 우선)
                if (globalData.viewer_preload_count)
                  resolvedSettings.preloadCount = parseInt(globalData.viewer_preload_count, 10);
                if (globalData.viewer_pull_threshold)
                  resolvedSettings.pullThreshold = parseInt(globalData.viewer_pull_threshold, 10);
                if (globalData.viewer_pull_sensitivity)
                  resolvedSettings.pullSensitivity = parseFloat(globalData.viewer_pull_sensitivity);
                if (globalData.viewer_show_threshold)
                  resolvedSettings.showThreshold = parseInt(globalData.viewer_show_threshold, 10);

                // 뷰어 스토어 초기화
                initializeSettings(resolvedSettings);
                setCurrentSeriesId(loadedSeriesId);

                console.log(`[Viewer] Settings initialized for series ${loadedSeriesId}:`, {
                  mode: resolvedSettings.readingMode,
                  dir: resolvedSettings.readingDirection,
                  source: seriesOverride ? "override" : "defaults",
                });
              } catch (err) {
                console.error("설정 계층 병합 로드 실패:", err);
              }
            }
          } catch (volumeErr) {
            console.warn("볼륨 정보 로드 실패:", volumeErr);
          }
        }

        // 3. 모든 데이터가 준비된 후 상태를 한꺼번에 업데이트
        // reset() 대신 initPage를 사용하여 중간 상태(1/0 등) 제거
        setChapter(chapterData);

        // 초기 스크롤 가드 설정 (효과들에서 이 플래그를 확인)
        isInitialScrollingRef.current = true;
        isInternalScrollRef.current = false; // 스크롤 이펙트가 동작하게 하기 위해 false로 설정

        // 페이지와 전체 페이지를 원자적으로 함께 업데이트
        initPage(startPage, chapterData.page_count);

        // 4. 페이지 메타데이터 로드 (두 페이지 모드에서 wide 페이지 감지용)
        try {
          const pagesRes = await chapterAPI.getPages(chapterId);
          const pages = pagesRes.data.pages || [];
          const meta: PageMeta[] = pages.map((page: { page_number: number; width: number; height: number }) => ({
            pageNumber: page.page_number,
            width: page.width || 0,
            height: page.height || 0,
            isWide: page.width > 0 && page.height > 0 && page.width > page.height * WIDE_RATIO_THRESHOLD,
          }));
          setPageMeta(meta);
        } catch (metaErr) {
          console.warn("페이지 메타데이터 로드 실패 (기존 방식으로 동작):", metaErr);
          setPageMeta([]); // 실패 시 빈 배열 (wide 감지 비활성)
        }
      } catch (err) {
        console.error("챕터 로드 실패:", err);
        setError("챕터를 불러올 수 없습니다.");
      } finally {
        // 모든 렌더링이 예약되고 스크롤 이동이 완전히 끝날 때까지
        // 넉넉한 지연 시간을 두어 '유령 스크롤' 감지를 방지합니다.
        setTimeout(() => setIsLoading(false), 500);
      }
    };

    loadChapter();
  }, [chapterId, setTotalPages, setCurrentPage, initPage, seriesSettings, initializeSettings, setCurrentSeriesId]);

  // 오디오 제어 Effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !bgmInfo?.exists || !bgmInfo.url) return;

    if (isBgmPlaying) {
      // audio.src = bgmInfo.url; // 제거: JSX에서 이미 설정됨, 재할당 시 재생 위치 초기화됨
      audio.play().catch((e) => console.log("BGM Auto-play blocked:", e));
    } else {
      audio.pause();
    }
  }, [isBgmPlaying, bgmInfo]);

  // 전역 BGM 설정 로드 (초기 1회 및 볼륨 변경 시)
  useEffect(() => {
    // 볼륨 ID가 없으면 실행하지 않음
    if (!chapterId) return;

    const fetchGlobalBgmSetting = async () => {
      try {
        const globalRes = await settingAPI.list();
        const globalData = (globalRes || {}) as Record<string, string>;
        // 기본값 true
        setIsBgmPlaying(globalData.bgm_enabled !== "false");
      } catch (e) {
        console.error("Failed to load global bgm setting", e);
      }
    };

    fetchGlobalBgmSetting();
  }, [chapterId]); // 챕터가 바뀌면(즉 다른 책으로 가면) 설정을 다시 확인 (사용자가 설정탭에서 바꿨을 수 있음)

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
        setIsLastChapterOfVolume(false);
      } else {
        // 볼륨의 마지막 챕터 -> 다음 볼륨 확인
        setNextChapterId(null);
        setNextChapterTitle(null);
        setIsLastChapterOfVolume(true); // 마지막 챕터임을 표시
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

  // 볼륨 완료 처리 함수 (중복 호출 방지 포함)
  const handleVolumeCompletion = useCallback(async () => {
    // 초기 로딩 중이거나 초기 정렬 중이면 절대 완료 처리 하지 않음
    if (isLoading || isInitialScrollingRef.current || !chapter || chapter.id !== chapterId) return;

    // 비정상적인 상태 검사 (totalPages가 0이거나 미달인 경우 무시)
    if (totalPages <= 0 || currentPage !== totalPages || !isLastChapterOfVolume) return;

    try {
      await volumeAPI.markComplete(chapter.volume_id);
      volumeCompletedRef.current = true;
      console.log(`볼륨 완료 처리: ${chapter.volume_id}`);
    } catch (completeErr) {
      console.error("볼륨 완료 처리 실패:", completeErr);
    }
  }, [chapter, chapterId, currentPage, totalPages, isLastChapterOfVolume]);

  // 진행도 즉시 저장
  const saveProgress = useCallback(async () => {
    // 시크릿 모드인 경우 저장하지 않음
    if (isIncognito) return;

    // 초기 로딩 중이거나 초기 정렬(스크롤 이동) 중이면 절대 저장 안 함
    if (isLoading || isInitialScrollingRef.current || !chapterId || !chapter || !seriesId || totalPages <= 0) return;

    // 현재 URL의 챕터 ID와 렌더링된 데이터가 일치하는지 한 번 더 확인
    if (chapter.id !== chapterId) return;

    // 페이지 번호가 유효 범위를 벗어난 경우 저장 안 함 (레이스 컨디션 방어)
    if (currentPage > totalPages || currentPage < 1) return;

    try {
      await seriesAPI.updateProgress(seriesId, {
        chapter_id: chapterId,
        volume_id: chapter.volume_id,
        current_page: currentPage,
        total_pages: totalPages,
        progress_percent: totalPages > 0 ? (currentPage / totalPages) * 100 : 0,
      });
      console.log(`진행도 저장: ${currentPage}/${totalPages} 페이지`);

      // 마지막 페이지에 도달한 경우 볼륨 완료 처리
      await handleVolumeCompletion();
    } catch (err) {
      console.error("진행도 저장 실패:", err);
    }
  }, [isLoading, chapterId, chapter, seriesId, currentPage, totalPages, handleVolumeCompletion]);

  // 페이지 변경 시 진행도 저장 (Throttle 처리)
  const lastSaveTimeRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading || !chapterId) return;

    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;

    // 이전에 예약된 타이머가 있다면 취소
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    if (timeSinceLastSave >= PROGRESS_SAVE_INTERVAL) {
      // 즉시 저장
      saveProgress();
      lastSaveTimeRef.current = now;
    } else {
      // 남은 시간만큼 대기 후 저장 (Trailing edge)
      saveTimerRef.current = setTimeout(() => {
        saveProgress();
        lastSaveTimeRef.current = Date.now();
      }, PROGRESS_SAVE_INTERVAL - timeSinceLastSave);
    }

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [currentPage, saveProgress, isLoading, chapterId]);

  // beforeunload 시 진행도 저장
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 시크릿 모드인 경우 저장하지 않음
      if (isIncognito) return;

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
  const handleNext = useCallback(async () => {
    if (currentPage < totalPages) {
      // 2장 보기 모드일 때 오프셋 설정에 따라 이동 간격(step) 계산
      let step = 1;
      if (settings.readingMode === "double") {
        // wide 페이지 체크 (현재, 다음, 또는 다다음 페이지 중 하나라도 wide면 페이지 스킵 방지를 위해 1칸씩 이동)
        const currentMeta = pageMetaMap.get(currentPage);
        const nextMeta = pageMetaMap.get(currentPage + 1);
        const nextNextMeta = pageMetaMap.get(currentPage + 2);

        if (currentMeta?.isWide || nextMeta?.isWide) {
          step = 1;
        } else {
          // 기본 이동 간격 계산
          const defaultStep = settings.pageOffset === 1 && currentPage === 1 ? 1 : 2;
          // 다다음 페이지가 wide라면 2장 이동 시 다음 페이지가 스킵되므로 1장만 이동
          if (defaultStep === 2 && nextNextMeta?.isWide) {
            step = 1;
          } else {
            step = defaultStep;
          }
        }
      }
      goToPage(currentPage + step);
    } else {
      // 마지막 페이지
      if (showNextHint && nextChapterId) {
        // 이미 힌트가 떠있으면 이동 전 현재 진행도 즉시 저장 (백엔드 동기화 보장)
        await saveProgress();
        navigate(`/viewer/${nextChapterId}`, { replace: true });
      } else if (nextChapterId) {
        // 힌트 표시
        setShowNextHint(true);
        // 3초 후 힌트 사라짐
        setTimeout(() => setShowNextHint(false), 3000);
      }
    }
  }, [
    currentPage,
    totalPages,
    goToPage,
    showNextHint,
    nextChapterId,
    navigate,
    saveProgress,
    settings.readingMode,
    settings.pageOffset,
    pageMetaMap,
  ]);

  // 이전 페이지/챕터 핸들러
  const handlePrev = useCallback(async () => {
    if (currentPage > 1) {
      // 2장 보기 모드일 때 오프셋 설정에 따라 이동 간격(step) 계산
      let step = 1;
      if (settings.readingMode === "double") {
        // wide 페이지 체크 (현재, 이전, 또는 전전 페이지 중 하나라도 wide면 페이지 스킵 방지를 위해 1칸씩 이동)
        const currentMeta = pageMetaMap.get(currentPage);
        const prevMeta = pageMetaMap.get(currentPage - 1);
        const prevPrevMeta = pageMetaMap.get(currentPage - 2);

        if (currentMeta?.isWide || prevMeta?.isWide) {
          step = 1;
        } else {
          // 기본 이동 간격 계산
          const defaultStep = settings.pageOffset === 1 && currentPage === 2 ? 1 : 2;
          // 전전 페이지가 wide라면 2장 이전 이동 시 이전 페이지가 스킵되므로 1장만 이동
          if (defaultStep === 2 && prevPrevMeta?.isWide) {
            step = 1;
          } else {
            step = defaultStep;
          }
        }
      }
      goToPage(currentPage - step);
    } else {
      // 첫 페이지
      if (showPrevHint && prevChapterId) {
        await saveProgress();
        navigate(`/viewer/${prevChapterId}?page=last`, { replace: true });
      } else if (prevChapterId) {
        setShowPrevHint(true);
        setTimeout(() => setShowPrevHint(false), 3000);
      }
    }
  }, [
    currentPage,
    goToPage,
    showPrevHint,
    prevChapterId,
    navigate,
    saveProgress,
    settings.readingMode,
    settings.pageOffset,
    pageMetaMap,
  ]);

  // 뒤로가기
  const handleBack = useCallback(() => {
    // 진행도 저장 후 이동
    saveProgress();
    navigate(-1);
  }, [saveProgress, navigate]);

  // 키보드 이벤트
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력 중이면 무시
      if (e.target instanceof HTMLInputElement) return;

      const isRTL = settings.keyboardDirection === "rtl";

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
        case "F":
        case "ㄹ": // 한글 입력 상태 대비
          e.preventDefault();
          handleToggleFullscreen();
          break;
        // F11은 브라우저 기본 동작에 맡기거나, 정 원하면 toggleFullscreen 연동
        // case "F11":
        //   e.preventDefault();
        //   toggleFullscreen();
        //   break;
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
  }, [
    settings.keyboardDirection,
    handleNext,
    handlePrev,
    goToPage,
    totalPages,
    isSettingsOpen,
    closeSettings,
    handleToggleFullscreen,
    handleBack,
  ]);

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

    const preloadCount = settings.preloadCount; // Store 기본값 사용 (6)
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
    if (isLoading) return; // 로딩 중에는 스크롤 동기화 하지 않음

    // 1. 현재 페이지로 스크롤 이동 (외부 요인으로 변경된 경우만)
    if (!isInternalScrollRef.current) {
      const pageEl = document.getElementById(`page-${currentPage}`);
      if (pageEl) {
        requestAnimationFrame(() => {
          const align = currentPage === totalPages ? "end" : "start";
          pageEl.scrollIntoView({ block: align });

          // 이동 완료 후 약간의 여유를 두고 가드 해제
          setTimeout(() => {
            isInitialScrollingRef.current = false;
          }, 150);
        });
      } else {
        isInitialScrollingRef.current = false;
      }
    } else {
      isInternalScrollRef.current = false;
    }
  }, [currentPage, settings.readingMode, isLoading]);

  // 페이지 모드(한/두페이지)에서는 로딩 완료 시 즉시 가드 해제
  useEffect(() => {
    if (settings.readingMode === "vertical") return;
    if (!isLoading) {
      isInitialScrollingRef.current = false;
    }
  }, [isLoading, settings.readingMode]);

  useEffect(() => {
    if (settings.readingMode !== "vertical") return;
    if (isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 초기 가드 중이면 무시
        if (isInitialScrollingRef.current) return;

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
      },
    );

    // 모든 페이지 관찰 (효율성 개선: querySelectorAll 사용)
    const pages = document.querySelectorAll(`.${styles.pageImageWrapper}`);
    pages.forEach((page) => observer.observe(page));

    return () => observer.disconnect();
  }, [totalPages, settings.readingMode, setCurrentPage, isLoading, chapterId]); // isLoading, chapterId 추가로 챕터 변경 및 로딩 완료 시 재설정

  // 세로 스크롤 모드: 오버스크롤 감지 (당기기 네비게이션)
  useEffect(() => {
    if (settings.readingMode !== "vertical" || isLoading) return;

    const content = viewerContentRef.current;
    if (!content) return;

    const handleWheel = (e: WheelEvent) => {
      if (isNavigatingRef.current) return;

      const isAtTop = content.scrollTop <= 0;
      const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;

      if (isAtTop && e.deltaY < 0 && prevChapterId) {
        e.preventDefault();
        setPullOffset((prev) => {
          const newOffset = Math.min(0, prev + e.deltaY * settings.pullSensitivity);
          // 임계값 도달 시 이동
          if (Math.abs(newOffset) >= settings.pullThreshold) {
            isNavigatingRef.current = true;
            saveProgress().then(() => {
              navigate(`/viewer/${prevChapterId}?page=last`, { replace: true });
            });
            return 0;
          }
          return newOffset;
        });
      } else if (isAtBottom && e.deltaY > 0 && nextChapterId) {
        e.preventDefault();
        setPullOffset((prev) => {
          const newOffset = Math.max(0, prev + e.deltaY * settings.pullSensitivity);
          if (newOffset >= settings.pullThreshold) {
            isNavigatingRef.current = true;
            saveProgress().then(() => {
              navigate(`/viewer/${nextChapterId}`, { replace: true });
            });
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

    const decayInterval = setInterval(() => {
      setPullOffset((prev) => {
        if (Math.abs(prev) < settings.showThreshold) return 0;
        return prev * 0.96; // 4% 씩 감쇠 (더 느리게)
      });
    }, 50);

    content.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      content.removeEventListener("wheel", handleWheel);
      clearInterval(decayInterval);
      isNavigatingRef.current = false;
    };
  }, [
    settings.readingMode,
    prevChapterId,
    nextChapterId,
    navigate,
    isLoading,
    saveProgress,
    settings.pullSensitivity,
    settings.pullThreshold,
    settings.showThreshold,
  ]);

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

    // wide 페이지 감지 (현재 페이지가 wide이면 단독 표시)
    const currentMeta = pageMetaMap.get(currentPage);
    if (currentMeta?.isWide) {
      return [currentPage];
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

    // startPage가 wide이며 현재 페이지가 아닐 때 (즉, 현재 페이지가 startPage + 1 인데 startPage가 wide한 경우)
    // 현재 페이지만 단독 표시해야 함
    const startMeta = pageMetaMap.get(startPage);
    if (startMeta?.isWide && startPage !== currentPage) {
      return [currentPage];
    }

    // 다음 페이지가 wide이면 현재 페이지만 표시 (또는 다음 페이지만 표시)
    const nextMeta = pageMetaMap.get(startPage + 1);
    if (nextMeta?.isWide) {
      if (startPage + 1 === currentPage) {
        return [currentPage];
      }
      return [startPage];
    }

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
        className={styles.viewerContainer}
        style={{ background: settings.backgroundColor }}
      >
        <div className={styles.viewerContent}>
          <div className={styles.pageLoading}>
            <div className={styles.spinner} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !chapter) {
    return (
      <div
        className={styles.viewerContainer}
        style={{ background: settings.backgroundColor }}
      >
        <div className={styles.viewerContent}>
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
      className={styles.viewerContainer}
      style={{ background: settings.backgroundColor }}
    >
      {/* BGM Audio Element */}
      {bgmInfo?.exists && bgmInfo.url && (
        <audio
          ref={audioRef}
          src={bgmInfo.url}
          loop
          autoPlay={isBgmPlaying}
        />
      )}

      {/* 상단 바 */}
      <header className={`${styles.viewerHeader} ${!isUIVisible ? styles.hidden : ""}`}>
        <button
          className={styles.headerBack}
          onClick={handleBack}
        >
          <ArrowLeft size={24} />
        </button>
        <div className={styles.headerTitle}>
          {isIncognito && (
            <Shield
              size={18}
              className={styles.incognitoIcon}
            />
          )}
          {chapter.title} - {currentPage} / {totalPages}
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.headerActionBtn}
            onClick={handleToggleFullscreen}
            title={isFullscreen ? "전체화면 종료" : "전체화면"}
          >
            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
          <button
            className={styles.headerSettings}
            onClick={toggleSettings}
          >
            <Settings size={24} />
          </button>

          {/* BGM Toggle */}
          {bgmInfo?.exists && (
            <button
              className={`${styles.headerActionBtn} ${styles.bgmButton} ${!isBgmPlaying ? styles.muted : ""}`}
              onClick={() => setIsBgmPlaying(!isBgmPlaying)}
              title={isBgmPlaying ? "배경음악 끄기" : "배경음악 켜기"}
            >
              <Music size={24} />
            </button>
          )}
        </div>
      </header>

      {/* 이미지 영역 */}
      <div
        ref={viewerContentRef}
        className={`${styles.viewerContent} ${styles[`mode${settings.readingMode.charAt(0).toUpperCase() + settings.readingMode.slice(1)}`]} ${styles[`direction${settings.readingDirection.charAt(0).toUpperCase() + settings.readingDirection.slice(1)}`]}`}
        onClick={(e) => {
          // 세로 모드일 때 클릭 시 UI 토글 (네비게이션 영역 제외)
          if (settings.readingMode === "vertical") {
            const target = e.target as HTMLElement;
            // 네비게이션 영역 클릭은 무시 (이미 별도 onClick 핸들러 있음)
            if (!target.closest(`.${styles.verticalChapterNav}`)) {
              toggleUI();
            }
          }
        }}
      >
        {/* 세로 모드: 이전 챕터 네비게이션 (당김 시에만 표시) */}
        {settings.readingMode === "vertical" && pullOffset < -20 && prevChapterId && (
          <div
            className={`${styles.verticalChapterNav} ${styles.prev} ${styles.pullIndicator}`}
            style={{
              transform: `translateY(${Math.min(0, pullOffset + 180)}px)`,
              opacity: Math.min(1, Math.abs(pullOffset) / 80),
            }}
            onClick={async () => {
              await saveProgress();
              navigate(`/viewer/${prevChapterId}?page=last`);
            }}
          >
            <div className={styles.verticalChapterNavContent}>
              <span className={styles.verticalChapterNavLabel}>
                ▲ 이전 ({Math.round((Math.abs(pullOffset) / 180) * 100)}%)
              </span>
              <span className={styles.verticalChapterNavTitle}>{prevChapterTitle}</span>
              <span className={styles.verticalChapterNavHint}>계속 위로 스크롤하면 이동</span>
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

          // 단독 wide 페이지 여부 (double 모드에서 1개만 표시될 때)
          const isSingleWideInDouble = isDoubleMode && displayPages.length === 1;

          return (
            <div
              key={index} // 중요: 페이지 번호가 아닌 index를 key로 사용하여 컴포넌트 재생성 방지
              id={`page-${pageNum}`} // 스크롤 이동을 위한 ID 추가
              className={`${styles.pageImageWrapper} ${isSingleWideInDouble ? styles.singleWide : ""}`}
            >
              <SmartImageViewer
                src={getPageImageUrl(chapter.id, pageNum)}
                nextSrc={nextSrc}
                alt={`페이지 ${pageNum}`}
                className={`${styles.pageImage} ${styles[`fit${settings.fitMode.charAt(0).toUpperCase() + settings.fitMode.slice(1)}`]} ${shouldHide ? styles.hidden : ""}`}
                onLoad={() => handleImageLoad(pageNum)}
              />
            </div>
          );
        })}

        {/* 클릭 영역 - 모든 모드에서 적용 */}
        <div className={styles.clickZones}>
          <div
            className={`${styles.clickZone} ${styles.zoneLeft}`}
            onClick={() => handleZoneClick("left")}
          />
          <div
            className={`${styles.clickZone} ${styles.zoneCenter}`}
            onClick={() => handleZoneClick("center")}
          />
          <div
            className={`${styles.clickZone} ${styles.zoneRight}`}
            onClick={() => handleZoneClick("right")}
          />
        </div>

        {/* 세로 모드: 다음 챕터 네비게이션 (당김 시에만 표시) */}
        {settings.readingMode === "vertical" && pullOffset > 10 && nextChapterId && (
          <div
            className={`${styles.verticalChapterNav} ${styles.next} ${styles.pullIndicator}`}
            style={{
              opacity: Math.min(1, pullOffset / 80),
            }}
            onClick={async () => {
              await saveProgress();
              navigate(`/viewer/${nextChapterId}`);
            }}
          >
            <div className={styles.verticalChapterNavContent}>
              <span className={styles.verticalChapterNavLabel}>▼ 다음 ({Math.round((pullOffset / 150) * 100)}%)</span>
              <span className={styles.verticalChapterNavTitle}>{nextChapterTitle}</span>
              <span className={styles.verticalChapterNavHint}>계속 아래로 스크롤하면 이동</span>
            </div>
          </div>
        )}
      </div>

      {/* 하단 바 */}
      <footer className={`${styles.viewerFooter} ${!isUIVisible ? styles.hidden : ""}`}>
        <div className={styles.footerControls}>
          <button
            className={styles.navBtn}
            onClick={() => goToPage(1)}
            disabled={currentPage === 1}
          >
            <ChevronsLeft size={20} />
          </button>
          <button
            className={styles.navBtn}
            onClick={handlePrev}
            disabled={currentPage === 1}
          >
            <ChevronLeft size={20} />
          </button>

          <div className={styles.pageSliderContainer}>
            <input
              type="range"
              className={styles.pageSlider}
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={handleSliderChange}
            />
            <div className={styles.pageInfo}>
              <span
                className={styles.pageInfoClickable}
                onClick={() => setShowPageJump(true)}
              >
                {currentPage} / {totalPages}
              </span>
            </div>
          </div>

          <button
            className={styles.navBtn}
            onClick={handleNext}
            disabled={currentPage >= totalPages && !nextChapterId}
          >
            <ChevronRight size={20} />
          </button>
          <button
            className={styles.navBtn}
            onClick={() => goToPage(totalPages)}
            disabled={currentPage >= totalPages}
          >
            <ChevronsRight size={20} />
          </button>

          {/* 토글 버튼 (태블릿/데스크탑) */}
          <div className={styles.footerToggles}>
            <button
              className={`${styles.toggleBtn} ${settings.readingMode === "double" ? styles.active : ""}`}
              onClick={async () => {
                const newMode = settings.readingMode === "single" ? "double" : "single";
                setReadingMode(newMode);

                // 설정 저장
                if (seriesId) {
                  try {
                    await seriesAPI.updateViewerSettings(seriesId, { reading_mode: newMode });
                  } catch (e) {
                    console.error("설정 저장 실패:", e);
                  }
                }
              }}
            >
              {settings.readingMode === "double" ? "2페이지" : "1페이지"}
            </button>
            <button
              className={`${styles.toggleBtn} ${settings.pageOffset === 1 ? styles.active : ""}`}
              onClick={togglePageOffset}
            >
              오프셋 {settings.pageOffset === 1 ? "+1" : "0"}
            </button>
          </div>
        </div>
      </footer>

      {/* 설정 모달 */}
      {isSettingsOpen && <ViewerSettingsModal onClose={closeSettings} />}

      {/* 페이지 점프 모달 */}
      {showPageJump && (
        <div
          className={styles.settingsOverlay}
          onClick={() => setShowPageJump(false)}
        >
          <div
            className={styles.pageJumpModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div>페이지 이동</div>
            <input
              type="number"
              className={styles.pageJumpInput}
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
        <div className={`${styles.chapterOverlay} ${styles.next}`}>
          <div className={styles.chapterOverlayContent}>
            <span className={styles.chapterOverlayLabel}>다음:</span>
            <span className={styles.chapterOverlayTitle}>{nextChapterTitle}</span>
            <span className={styles.chapterOverlayDesc}>한 번 더 누르면 이동합니다</span>
          </div>
        </div>
      )}

      {/* 이전 챕터 이동 힌트 */}
      {showPrevHint && prevChapterTitle && (
        <div className={`${styles.chapterOverlay} ${styles.prev}`}>
          <div className={styles.chapterOverlayContent}>
            <span className={styles.chapterOverlayLabel}>이전:</span>
            <span className={styles.chapterOverlayTitle}>{prevChapterTitle}</span>
            <span className={styles.chapterOverlayDesc}>한 번 더 누르면 이동합니다</span>
          </div>
        </div>
      )}
    </div>
  );
}
