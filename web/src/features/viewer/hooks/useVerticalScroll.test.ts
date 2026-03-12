import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVerticalScroll } from "./useVerticalScroll";

const { mocks } = vi.hoisted(() => {
  const setCurrentPageMock = vi.fn();
  const navigateMock = vi.fn();
  const useViewerStoreMock = Object.assign(
    vi.fn(() => ({ setCurrentPage: setCurrentPageMock })),
    {
      getState: vi.fn(() => ({ currentPage: 1 })),
    },
  );
  return {
    mocks: {
      setCurrentPageMock,
      navigateMock,
      useViewerStoreMock,
    },
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigateMock,
  useLocation: () => ({ state: { from: "/series/abc" } }),
}));

vi.mock("../../../stores/viewerStore", () => ({
  useViewerStore: mocks.useViewerStoreMock,
}));

class IntersectionObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  callback: (entries: IntersectionObserverEntry[]) => void;
  options: unknown;
  constructor(callback: (entries: IntersectionObserverEntry[]) => void, options: unknown) {
    this.callback = callback;
    this.options = options;
  }
}

describe("useVerticalScroll initial guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock as unknown as typeof IntersectionObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("history", {
      scrollRestoration: "auto",
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries scroll positioning before releasing initial guard when still at top", () => {
    const isInitialScrollingRef = { current: true };
    const scrollIntoView = vi.fn();
    const pageRect = { top: 100, height: 800 }; // 처음에 멀리 떨어져 있는 것으로 설정
    const pageEl = {
      scrollIntoView,
      getBoundingClientRect: vi.fn(() => pageRect),
    } as unknown as HTMLElement;
    const getElementByIdSpy = vi.spyOn(document, "getElementById").mockReturnValue(pageEl);

    const mockContent = {
      scrollTop: 0,
      clientHeight: 800,
      scrollHeight: 4000,
      style: {}, // style 객체 추가 (opacity 설정 대응)
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0, height: 800 })), // 추가
    } as unknown as HTMLDivElement;

    const { result, rerender } = renderHook(
      ({ currentPage }) =>
        useVerticalScroll({
          readingMode: "vertical",
          isLoading: false,
          currentPage,
          totalPages: 30,
          nextChapterId: null,
          prevChapterId: null,
          pullThreshold: 100,
          pullSensitivity: 0.6,
          saveProgress: async () => {},
          handleVolumeCompletion: async () => {},
          chapterId: "chapter-1",
          isInitialScrollingRef,
        }),
      { initialProps: { currentPage: 8 } },
    );

    act(() => {
      result.current.viewerContentRef.current = mockContent;
    });

    act(() => {
      rerender({ currentPage: 9 });
    });

    act(() => {
      vi.advanceTimersByTime(200); // 첫 번째 releaseGuard 실행 시도
    });

    // initial scroll attempt
    expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(1);

    act(() => {
      // 첫 번째 시도 후 위치가 안 잡힌 것으로 시뮬레이션 (비대칭)
      pageRect.top = 100;
      vi.advanceTimersByTime(200); // 재시도(retryReleaseTimeoutId) 트리거 대기
    });

    act(() => {
      // 이제 위치가 잡힌 것으로 시뮬레이션
      pageRect.top = 0;
      vi.advanceTimersByTime(200); // 최종 해제
    });

    // initial + retry attempts
    expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(isInitialScrollingRef.current).toBe(false);
    expect(getElementByIdSpy).toHaveBeenCalledWith("page-9");
    expect(mocks.setCurrentPageMock).not.toHaveBeenCalledWith(1);
    getElementByIdSpy.mockRestore();
  });
});
