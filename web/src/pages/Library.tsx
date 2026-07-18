import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import { Folder, RefreshCw } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import type { Library } from "../stores/libraryStore";
import { useAuthStore } from "../stores/authStore";
import { libraryAPI } from "../api/client";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { Toast } from "../components/common/Toast";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Series } from "../types/series";
import {
  compareSeriesGroupKey,
  compareSeriesByDisplayName,
  getLibrarySeriesCountLabelKey,
  getSeriesDisplayContext,
  getSeriesDisplayName,
  getSeriesGroupKey,
} from "../utils/librarySeries";
import { rememberReturnFocus, takeReturnFocus } from "../utils/returnFocus";
import { prefersReducedMotion } from "../utils/reducedMotion";
import styles from "./Library.module.css";

const POLL_INTERVAL_MS = 3000;
const HEADER_SCROLL_THRESHOLD_PX = 184; // 헤더 높이(172px)와 시각적 여유(12px)를 합친 활성화 기준선
const INDEX_TOP_RETRY_DELAY_MS = 100;
const INDEX_SCROLL_LOCK_MS = 600;
const GRID_MIN_VISIBLE_TOP_PX = 92; // 카드 그리드 top이 이 값 이상일 때만 유효한 측정으로 본다.
const INDEX_BOTTOM_VIEWPORT_GAP_PX = 24;
const INDEX_MIN_HEIGHT_PX = 160;
const INDEX_SCROLLBAR_VISIBILITY_MS = 900;
const INDEX_SCROLLBAR_MIN_THUMB_PX = 28;

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();

  const { fetchLibraries, triggerRefresh, refreshKey } = useLibraryStore();
  const currentLibraryScanStatus = useLibraryStore(
    (state) => state.libraries.find((l) => l.id === id)?.scan_status,
  );

  // 데이터 상태
  const [library, setLibrary] = useState<Library | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [indexPosition, setIndexPosition] = useState<{ top: number; right: number; maxHeight: number } | null>(null);
  const [isIndexInteracting, setIsIndexInteracting] = useState(false);
  const [hasIndexOverflow, setHasIndexOverflow] = useState(false);
  const [indexScrollbarThumb, setIndexScrollbarThumb] = useState<{ top: number; height: number } | null>(null);
  const loadSequenceRef = useRef(0);
  const lastFetchedIdRef = useRef<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const seriesCardRefs = useRef<Record<string, HTMLDivElement>>({});
  const indexButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const scrollingToGroupRef = useRef<string | null>(null);
  const scrollReleaseTimeoutRef = useRef<number | null>(null);
  const indexInteractionTimeoutRef = useRef<number | null>(null);
  const syncingIndexScrollRef = useRef(false);
  const syncingIndexScrollFrameRef = useRef<number | null>(null);
  const indexScrollbarFrameRef = useRef<number | null>(null);
  const seriesGridRef = useRef<HTMLDivElement | null>(null);
  const seriesIndexRef = useRef<HTMLElement | null>(null);
  const seriesIndexScrollAreaRef = useRef<HTMLDivElement | null>(null);

  const user = useAuthStore((state) => state.user);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sortedSeriesList = useMemo(() => {
    return [...seriesList].sort(compareSeriesByDisplayName);
  }, [seriesList]);

  const groupedSeriesList = useMemo(() => {
    const groupsByKey = new Map<string, Series[]>();
    for (const series of sortedSeriesList) {
      const groupKey = getSeriesGroupKey(getSeriesDisplayName(series));
      const existingItems = groupsByKey.get(groupKey);
      if (existingItems) {
        existingItems.push(series);
      } else {
        groupsByKey.set(groupKey, [series]);
      }
    }
    return Array.from(groupsByKey.entries())
      .sort(([a], [b]) => compareSeriesGroupKey(a, b))
      .map(([key, items]) => ({ key, items }));
  }, [sortedSeriesList]);

  const loadData = useCallback(
    async (isInitial = false) => {
      if (!id) return;
      const currentLoad = ++loadSequenceRef.current;
      if (isInitial) {
        setIsLoading(true);
      }

      try {
        const response = await libraryAPI.get(id);
        if (currentLoad !== loadSequenceRef.current) return;
        setLibrary(response.data);

        const seriesResponse = await libraryAPI.getSeries(id);
        const loadedSeries: Series[] = seriesResponse.data.series || [];
        if (currentLoad !== loadSequenceRef.current) return;
        setSeriesList(loadedSeries);
      } catch (error) {
        console.error("Failed to load library data:", error);
      } finally {
        if (currentLoad === loadSequenceRef.current) {
          // 초기 진입과 새로고침 모두 최신 요청이 끝나면 로딩을 해제해야 화면이 갱신된다.
          setIsLoading(false);
        }
      }
    },
    [id],
  );

  useEffect(() => {
    if (id) {
      const isInitial = lastFetchedIdRef.current !== id;
      lastFetchedIdRef.current = id;

      const timer = window.setTimeout(() => {
        void loadData(isInitial);
      }, 0);
      fetchLibraries(isInitial);
      // ID가 바뀌면 사이드바 닫기 (선택적)
      setSidebarOpen(false);
      return () => {
        window.clearTimeout(timer);
        loadSequenceRef.current += 1;
      };
    }
  }, [id, refreshKey, loadData, fetchLibraries]);

  useEffect(() => {
    if (!id || isLoading) return;

    // App의 전역 scroll-to-top effect가 끝난 다음 프레임에 복귀 스크롤을 적용한다.
    // StrictMode의 effect 재실행에서도 취소된 프레임은 storage를 소비하지 않는다.
    const frameId = window.requestAnimationFrame(() => {
      const seriesId = takeReturnFocus("library", id);
      const target = seriesId ? seriesCardRefs.current[seriesId] : null;
      if (!target) return;

      target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [id, isLoading, seriesList]);

  // 스캔 중일 때 시리즈 목록 실시간 폴링
  // - isScanning: 이 페이지에서 직접 스캔 버튼을 눌렀을 때 (libraryAPI.scan은 동기 블로킹이므로 스토어 갱신 없음)
  // - currentLibraryScanStatus: 외부(다른 탭/스케줄러 등)에서 스캔이 시작된 경우
  useEffect(() => {
    if (!isScanning && currentLibraryScanStatus !== "SCANNING") return;

    let timeoutId: number;
    let isMounted = true;

    const poll = async () => {
      if (!isMounted) return;
      await Promise.all([loadData(false), fetchLibraries(false)]);
      if (isMounted) {
        timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [isScanning, currentLibraryScanStatus, loadData, fetchLibraries]);

  const handleScan = async () => {
    if (!id) return;
    setIsScanning(true);
    setStatus(null); // 이전 메시지 제거
    setTimeout(() => {
      setStatus({ type: "info", message: t("settings.libraries.toast.scan_started") });
    }, 0);
    try {
      await libraryAPI.scan(id);
      await loadData();
      triggerRefresh();
      setStatus(null); // 이전 메시지 제거
      setTimeout(() => {
        setStatus({ type: "success", message: t("settings.libraries.toast.scan_completed") });
      }, 0);
    } catch (error: unknown) {
      console.error("Scan failed:", error);
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 409) {
        setStatus({ type: "info", message: t("settings.libraries.toast.scan_running") });
        // 스토어 scan_status를 SCANNING으로 갱신해야 폴링 effect가 유지됨
        await fetchLibraries(false);
      } else {
        setStatus({ type: "error", message: t("settings.libraries.toast.scan_failed") });
        await loadData(false);  // 실패 후 최신 상태로 복원
      }
    } finally {
      setIsScanning(false);
    }
  };

  const showIndexScrollbar = useCallback(() => {
    if (!hasIndexOverflow) {
      return;
    }

    setIsIndexInteracting(true);
    if (indexInteractionTimeoutRef.current !== null) {
      window.clearTimeout(indexInteractionTimeoutRef.current);
    }
    indexInteractionTimeoutRef.current = window.setTimeout(() => {
      setIsIndexInteracting(false);
      indexInteractionTimeoutRef.current = null;
    }, INDEX_SCROLLBAR_VISIBILITY_MS);
  }, [hasIndexOverflow]);

  const updateIndexScrollbarThumb = useCallback(() => {
    const scrollArea = seriesIndexScrollAreaRef.current;
    if (!scrollArea) {
      setIndexScrollbarThumb(null);
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollArea;
    const nextHasOverflow = scrollHeight > clientHeight + 1;
    setHasIndexOverflow((current) => (current === nextHasOverflow ? current : nextHasOverflow));

    if (!nextHasOverflow) {
      setIndexScrollbarThumb(null);
      setIsIndexInteracting(false);
      return;
    }

    const thumbHeight = Math.max(INDEX_SCROLLBAR_MIN_THUMB_PX, (clientHeight / scrollHeight) * clientHeight);
    const maxThumbTop = Math.max(0, clientHeight - thumbHeight);
    const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
    const thumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

    setIndexScrollbarThumb((current) => {
      if (
        current &&
        Math.abs(current.top - thumbTop) < 0.5 &&
        Math.abs(current.height - thumbHeight) < 0.5
      ) {
        return current;
      }

      return { top: thumbTop, height: thumbHeight };
    });
  }, []);

  const scheduleIndexScrollbarThumbUpdate = useCallback(() => {
    if (indexScrollbarFrameRef.current !== null) {
      return;
    }

    indexScrollbarFrameRef.current = window.requestAnimationFrame(() => {
      indexScrollbarFrameRef.current = null;
      updateIndexScrollbarThumb();
    });
  }, [updateIndexScrollbarThumb]);

  const scrollToGroup = (groupKey: string) => {
    setActiveGroupKey(groupKey);
    scrollingToGroupRef.current = groupKey;
    showIndexScrollbar();
    if (scrollReleaseTimeoutRef.current !== null) {
      window.clearTimeout(scrollReleaseTimeoutRef.current);
    }
    const target = sectionRefs.current[groupKey];
    if (target) {
      const reducedMotion = prefersReducedMotion();
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      scrollReleaseTimeoutRef.current = window.setTimeout(() => {
        scrollingToGroupRef.current = null;
        scrollReleaseTimeoutRef.current = null;
      }, reducedMotion ? 0 : INDEX_SCROLL_LOCK_MS);
    } else {
      scrollingToGroupRef.current = null;
    }
  };

  useEffect(() => {
    if (groupedSeriesList.length === 0) {
      setActiveGroupKey(null);
      return;
    }

    const updateActiveGroup = () => {
      if (scrollingToGroupRef.current !== null) {
        return;
      }

      let nextActiveKey = groupedSeriesList[0]?.key ?? null;

      for (const group of groupedSeriesList) {
        const node = sectionRefs.current[group.key];
        if (!node) continue;

        if (node.getBoundingClientRect().top <= HEADER_SCROLL_THRESHOLD_PX) {
          nextActiveKey = group.key;
        } else {
          break;
        }
      }

      setActiveGroupKey((current) => (current === nextActiveKey ? current : nextActiveKey));
    };

    let frameId: number | null = null;
    const scheduleActiveGroupUpdate = () => {
      if (frameId !== null) return;

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateActiveGroup();
      });
    };

    updateActiveGroup();
    window.addEventListener("scroll", scheduleActiveGroupUpdate, { passive: true });
    window.addEventListener("resize", scheduleActiveGroupUpdate);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (scrollReleaseTimeoutRef.current !== null) {
        window.clearTimeout(scrollReleaseTimeoutRef.current);
        scrollReleaseTimeoutRef.current = null;
      }
      if (indexInteractionTimeoutRef.current !== null) {
        window.clearTimeout(indexInteractionTimeoutRef.current);
        indexInteractionTimeoutRef.current = null;
        setIsIndexInteracting(false);
      }
      window.removeEventListener("scroll", scheduleActiveGroupUpdate);
      window.removeEventListener("resize", scheduleActiveGroupUpdate);
    };
  }, [groupedSeriesList]);

  useEffect(() => {
    if (!activeGroupKey) return;

    const scrollArea = seriesIndexScrollAreaRef.current;
    const activeButton = indexButtonRefs.current[activeGroupKey];
    if (!scrollArea || !activeButton) return;

    syncingIndexScrollRef.current = true;
    const scrollAreaRect = scrollArea.getBoundingClientRect();
    const activeButtonRect = activeButton.getBoundingClientRect();
    const buttonCenterInScrollArea =
      activeButtonRect.top - scrollAreaRect.top + scrollArea.scrollTop + activeButtonRect.height / 2;
    const targetScrollTop =
      buttonCenterInScrollArea - scrollArea.clientHeight / 2;
    const nextScrollTop = Math.max(0, targetScrollTop);
    if (typeof scrollArea.scrollTo === "function") {
      scrollArea.scrollTo({
        top: nextScrollTop,
        behavior: "auto",
      });
    } else {
      scrollArea.scrollTop = nextScrollTop;
    }
    if (syncingIndexScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(syncingIndexScrollFrameRef.current);
    }
    syncingIndexScrollFrameRef.current = window.requestAnimationFrame(() => {
      updateIndexScrollbarThumb();
      syncingIndexScrollRef.current = false;
      syncingIndexScrollFrameRef.current = null;
    });

    return () => {
      if (syncingIndexScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(syncingIndexScrollFrameRef.current);
        syncingIndexScrollFrameRef.current = null;
      }
      syncingIndexScrollRef.current = false;
    };
  }, [activeGroupKey, updateIndexScrollbarThumb]);

  useEffect(() => {
    const scrollArea = seriesIndexScrollAreaRef.current;
    if (!scrollArea) {
      setHasIndexOverflow(false);
      setIndexScrollbarThumb(null);
      return;
    }

    updateIndexScrollbarThumb();
    let resizeObserver: ResizeObserver | null = null;
    const handleWindowResize = () => {
      scheduleIndexScrollbarThumbUpdate();
    };

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(scheduleIndexScrollbarThumbUpdate);
      resizeObserver.observe(scrollArea);
    } else {
      window.addEventListener("resize", handleWindowResize);
    }

    return () => {
      resizeObserver?.disconnect();
      if (resizeObserver === null) {
        window.removeEventListener("resize", handleWindowResize);
      }
      if (indexScrollbarFrameRef.current !== null) {
        window.cancelAnimationFrame(indexScrollbarFrameRef.current);
        indexScrollbarFrameRef.current = null;
      }
      if (syncingIndexScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(syncingIndexScrollFrameRef.current);
        syncingIndexScrollFrameRef.current = null;
        syncingIndexScrollRef.current = false;
      }
    };
  }, [groupedSeriesList, indexPosition, scheduleIndexScrollbarThumbUpdate, updateIndexScrollbarThumb]);

  useEffect(() => {
    if (groupedSeriesList.length === 0) {
      setIndexPosition(null);
      return;
    }

    const updateIndexPosition = () => {
      const grid = seriesGridRef.current;
      const index = seriesIndexRef.current;
      if (!grid || !index) return;

      const gridRect = grid.getBoundingClientRect();
      const indexRect = index.getBoundingClientRect();
      const viewportRight = window.innerWidth;
      const gutterWidth = Math.max(0, viewportRight - gridRect.right);
      const centeredRight = Math.max(8, gutterWidth / 2 - indexRect.width / 2);
      const nextTop = gridRect.top;
      const minValidTop = GRID_MIN_VISIBLE_TOP_PX;
      const maxValidTop = window.innerHeight * 0.7; // 뷰포트 하단에 너무 가까우면 초기 측정이 흔들린 것으로 간주한다.
      const hasValidTop = nextTop > minValidTop && nextTop < maxValidTop;

      setIndexPosition((current) => {
        const resolvedTop = hasValidTop ? nextTop : current?.top;
        if (resolvedTop === undefined) {
          return current ?? null;
        }

        const nextMaxHeight = Math.max(
          INDEX_MIN_HEIGHT_PX,
          window.innerHeight - resolvedTop - INDEX_BOTTOM_VIEWPORT_GAP_PX,
        );

        if (
          current &&
          Math.abs(current.right - centeredRight) < 0.5 &&
          Math.abs(current.top - resolvedTop) < 0.5 &&
          Math.abs(current.maxHeight - nextMaxHeight) < 0.5
        ) {
          return current;
        }

        return { top: resolvedTop, right: centeredRight, maxHeight: nextMaxHeight };
      });
    };

    let frameId: number | null = null;
    const scheduleIndexPositionUpdate = () => {
      if (frameId !== null) return;

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateIndexPosition();
      });
    };

    scheduleIndexPositionUpdate();
    const retryId = window.setTimeout(scheduleIndexPositionUpdate, INDEX_TOP_RETRY_DELAY_MS);
    window.addEventListener("resize", scheduleIndexPositionUpdate);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.clearTimeout(retryId);
      window.removeEventListener("resize", scheduleIndexPositionUpdate);
    };
  }, [groupedSeriesList, sidebarOpen]);

  if (isLoading) {
    return (
      <div className={styles.libraryContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <LoadingSpinner fullScreen />
      </div>
    );
  }

  // 라이브러리를 찾을 수 없는 경우
  if (!library) {
    return (
      <div className={styles.libraryContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className={styles.errorContainer}>
          <p>{t("home.library.not_found")}</p>
          <Link
            to="/"
            className={styles.backLink}
          >
            {t("common.go_home")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.libraryContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* 메인 콘텐츠 */}
      <div className={styles.libraryContentWrapper}>
        <SubHeader
          showBackButton={false}
          title={
            <>
              <Folder size={24} /> {library.name}
            </>
          }
          rightContent={
            library.type !== "SYSTEM" &&
            user?.role === "MASTER" && (
              <button
                onClick={handleScan}
                disabled={isScanning}
                className={styles.scanBtn}
              >
                {isScanning ? (
                  <>
                    <RefreshCw
                      size={16}
                      className={styles.spin}
                    />{" "}
                    {t("home.library.scan_in_progress")}
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} /> {t("home.library.scan")}
                  </>
                )}
              </button>
            )
          }
        />

        {/* 시리즈 그리드 */}
        <main className={styles.libraryMain}>
          <div className={styles.seriesCount}>
            <Trans
              i18nKey="home.library.total_series"
              count={sortedSeriesList.length}
              components={{ strong: <strong /> }}
            />
          </div>

          {sortedSeriesList.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{t("home.library.empty_series")}</p>
              {library.type !== "SYSTEM" && user?.role === "MASTER" && (
                <button
                  onClick={handleScan}
                  className={`${styles.scanBtn} ${styles.primary}`}
                >
                  <RefreshCw size={16} /> {t("home.library.scan_now")}
                </button>
              )}
            </div>
          ) : (
            <div className={styles.seriesLayout}>
              <nav
                ref={seriesIndexRef}
                className={styles.seriesIndex}
                aria-label={t("home.library.series_index_nav", { count: sortedSeriesList.length })}
                style={
                  indexPosition
                    ? {
                        top: `${indexPosition.top}px`,
                        right: `${indexPosition.right}px`,
                        maxHeight: `${indexPosition.maxHeight}px`,
                      }
                    : undefined
                }
              >
                <div
                  ref={seriesIndexScrollAreaRef}
                  className={styles.seriesIndexScrollArea}
                  onScroll={() => {
                    if (syncingIndexScrollRef.current) {
                      return;
                    }

                    scheduleIndexScrollbarThumbUpdate();
                    showIndexScrollbar();
                  }}
                  onWheel={showIndexScrollbar}
                  onTouchStart={showIndexScrollbar}
                  onPointerDown={showIndexScrollbar}
                  onFocus={showIndexScrollbar}
                >
                  {groupedSeriesList.map((group) => (
                    <button
                      ref={(node) => {
                        indexButtonRefs.current[group.key] = node;
                      }}
                      key={group.key}
                      type="button"
                      className={`${styles.seriesIndexButton} ${activeGroupKey === group.key ? styles.seriesIndexButtonActive : ""}`}
                      onClick={() => scrollToGroup(group.key)}
                      aria-label={t("home.library.series_index_jump", { key: group.key })}
                      aria-current={activeGroupKey === group.key ? "location" : undefined}
                    >
                      {group.key}
                    </button>
                  ))}
                </div>
                {hasIndexOverflow && indexScrollbarThumb && (
                  <div
                    className={`${styles.seriesIndexScrollbar} ${isIndexInteracting ? styles.seriesIndexScrollbarVisible : ""}`}
                    aria-hidden="true"
                  >
                    <div
                      className={styles.seriesIndexScrollbarThumb}
                      style={{
                        height: `${indexScrollbarThumb.height}px`,
                        transform: `translateY(${indexScrollbarThumb.top}px)`,
                      }}
                    />
                  </div>
                )}
              </nav>

              <div
                ref={seriesGridRef}
                className={styles.seriesGrid}
              >
                {groupedSeriesList.map((group) => (
                  <Fragment key={group.key}>
                    {group.items.map((series, index) => {
                      const displayContext = getSeriesDisplayContext(series.path, library.paths);
                      const countLabel = getLibrarySeriesCountLabelKey(series);
                      const customSubtitle = countLabel
                        ? t(countLabel.key, { count: countLabel.count })
                        : displayContext || undefined;
                      return (
                        <div
                          key={series.id}
                          ref={(node) => {
                            if (node) {
                              seriesCardRefs.current[series.id] = node;
                            } else {
                              delete seriesCardRefs.current[series.id];
                            }
                            if (index === 0) {
                              sectionRefs.current[group.key] = node;
                            }
                          }}
                          className={styles.seriesCardAnchor}
                        >
                          <SeriesCard
                            item={series}
                            type="series"
                            customSubtitle={customSubtitle}
                            progressStyle="overlay"
                            showExtensionBadge
                            onStatusChange={loadData}
                            onBeforeNavigate={() => {
                              if (id) rememberReturnFocus("library", id, series.id);
                            }}
                          />
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
