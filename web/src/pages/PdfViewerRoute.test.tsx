import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";
import { PdfViewerRoute } from "./PdfViewerRoute";
import { useViewerStore } from "../stores/viewerStore";
import { takeReturnFocus } from "../utils/returnFocus";

const useProgressSyncMock = vi.fn();
const useViewerSyncMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../components/modals/AlertModal", () => ({
  AlertModal: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) => (isOpen ? <button type="button" data-testid="terminated-confirm" onClick={onConfirm} /> : null),
}));

vi.mock("./PdfViewer", () => ({
  PdfViewer: ({
    onDocumentLoad,
    onPageChange,
    terminatedInfo,
    onConfirmTerminated,
  }: {
    onDocumentLoad: (pages: number) => void;
    onPageChange: (page: number) => void;
    terminatedInfo: { isOpen: boolean };
    onConfirmTerminated: () => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="pdf-load"
        onClick={() => onDocumentLoad(20)}
      />
      <button
        type="button"
        data-testid="pdf-page-1"
        onClick={() => onPageChange(1)}
      />
      <button
        type="button"
        data-testid="pdf-page-7"
        onClick={() => onPageChange(7)}
      />
      {terminatedInfo.isOpen && (
        <button
          type="button"
          data-testid="terminated-confirm"
          onClick={onConfirmTerminated}
        />
      )}
    </div>
  ),
}));

vi.mock("../features/viewer", () => ({
  useBGM: () => ({
    bgmInfo: null,
    isBgmPlaying: false,
    setIsBgmPlaying: vi.fn(),
    audioRef: { current: null },
  }),
  useAdjacentChapters: () => ({
    nextChapterId: null,
    prevChapterId: null,
    isLastChapterOfVolume: false,
    isAdjacentResolved: true,
  }),
  useProgress: () => ({
    saveProgress: vi.fn(),
  }),
  UI_HIDE_DELAY: 1500,
  useProgressSync: (...args: unknown[]) => useProgressSyncMock(...args),
  useExitFullscreenOnViewerUnmount: () => {},
  useRestoreFullscreenAfterChapterSwitch: () => {},
}));

vi.mock("../hooks/useViewerSync", () => ({
  useViewerSync: (...args: unknown[]) => useViewerSyncMock(...args),
}));

vi.mock("../hooks/useReadingTime", () => ({
  useReadingTime: () => {},
}));

vi.mock("../features/viewer/hooks/useViewerNavigation", () => ({
  useViewerNavigation: () => ({
    handleNext: vi.fn(),
    handlePrev: vi.fn(),
    handleBack: vi.fn(),
  }),
}));

vi.mock("../features/viewer/hooks/usePreventBrowserZoom", () => ({
  usePreventBrowserZoom: () => {},
}));

describe("PdfViewerRoute", () => {
  beforeEach(() => {
    useProgressSyncMock.mockReset();
    useProgressSyncMock.mockReturnValue({
      showSyncModal: false,
      serverProgress: null,
      handleConfirmSync: vi.fn(),
      handleCloseModal: vi.fn(),
    });
    useViewerSyncMock.mockReset();
    useViewerSyncMock.mockReturnValue({
      terminatedInfo: {
        isOpen: false,
        reason: "",
      },
    });
    useViewerStore.setState({
      currentPage: 1,
      totalPages: 0,
    });
  });

  it("문서 로드 후 복원 대상 페이지에 도달하면 ready 상태를 연다", async () => {
    const setViewStatus = vi.fn();

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-7"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <PdfViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-7",
                    volume_id: "volume-1",
                    title: "PDF 챕터",
                    chapter_number: 1,
                    page_count: 20,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  restorePosition: { currentPage: 7, anchorPage: 7, offsetRatio: 0 },
                  setViewStatus,
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(useProgressSyncMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isRestoreSettled: false,
      }),
    );

    act(() => {
      screen.getByTestId("pdf-load").click();
    });

    expect(setViewStatus).not.toHaveBeenCalled();
    expect(useProgressSyncMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isRestoreSettled: false,
      }),
    );

    act(() => {
      screen.getByTestId("pdf-page-7").click();
    });

    await waitFor(() => {
      expect(setViewStatus).toHaveBeenCalledWith("ready");
      expect(useProgressSyncMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          isRestoreSettled: true,
        }),
      );
    });
  });

  it("세션 종료 확인 시 viewerFrom으로 replace 이동한다", async () => {
    useViewerSyncMock.mockReturnValue({
      terminatedInfo: {
        isOpen: true,
        reason: "session ended",
      },
    });

    const router = createMemoryRouter(
      [
        {
          path: "/viewer/:chapterId",
          element: (
            <PdfViewerRoute
              loaderData={{
                chapter: {
                  id: "chapter-7",
                  volume_id: "volume-150",
                  title: "PDF 챕터 150",
                  chapter_number: 1,
                  page_count: 20,
                },
                isLoading: false,
                error: null,
                seriesId: "series-1",
                volumeId: "volume-150",
                pageMeta: [],
                pageMetaMap: new Map(),
                isInitialScrollingRef: { current: false },
              }}
            />
          ),
        },
        {
          path: "/series/1",
          element: <div data-testid="series-page">series page</div>,
        },
      ],
      {
        initialEntries: [{ pathname: "/viewer/chapter-7", state: { from: "/series/1" } }],
      },
    );

    render(
      <RouterProvider router={router} />,
    );

    act(() => {
      screen.getByTestId("terminated-confirm").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("series-page")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/series/1");
      expect(router.state.historyAction).toBe("REPLACE");
    });
    expect(takeReturnFocus("series", "series-1")).toBe("volume-150");
  });
});
