import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PdfViewer } from "./PdfViewer";

const pdf = vi.hoisted(() => vi.fn());
vi.mock("../features/viewer/components/PdfChapterViewer", () => ({ PdfChapterViewer: (props: unknown) => { pdf(props); return null; } }));
vi.mock("../features/viewer", () => ({ ViewerHeader: () => null, ViewerFooter: () => null, PageJumpModal: () => null, SyncConfirmModal: () => null, ChapterListModal: () => null }));
vi.mock("../features/viewer/components/PdfTOC", () => ({ PdfTOC: () => null }));
vi.mock("../components/viewer/ViewerSettings", () => ({ ViewerSettings: () => null }));
vi.mock("../components/modals/AlertModal", () => ({ AlertModal: () => null }));
afterEach(() => { cleanup(); pdf.mockClear(); });

it("forwards swipe direction from PdfViewer settings to the native PDF renderer", () => {
  const noop = () => {};
  const props: ComponentProps<typeof PdfViewer> = {
    chapterId: "pdf", seriesId: "A", chapterTitle: "PDF", currentPage: 1, totalPages: 3,
    isUIVisible: false, isSettingsOpen: false, isFullscreen: false, isIncognito: false,
    bgmInfo: null, isBgmPlaying: false, tocItems: [], serverProgress: null, terminatedInfo: { isOpen: false, reason: "" },
    showPageJump: false, showSyncModal: false, showTOC: false, nextChapterId: null,
    audioRef: { current: null }, showZoomControls: false, zoomPercent: 100, isChapterListOpen: false,
    sessionForceLogoutTitle: "Session ended",
    onBack: noop, onToggleFullscreen: noop, onToggleSettings: noop, onToggleBgm: noop, onToggleTOC: noop,
    onZoomIn: noop, onZoomOut: noop, onZoomReset: noop, onDocumentLoad: noop, onOutlineLoad: noop,
    onNext: noop, onPrev: noop, onGoToPage: noop, onPageJumpClick: noop, onReadingModeChange: noop,
    onTogglePageOffset: noop, onToggleChapterList: noop, onCloseChapterList: noop, onChapterNavigate: noop,
    onCloseSettings: noop, onClosePageJump: noop, onPageJump: noop, onConfirmSync: noop, onCloseSync: noop,
    onConfirmTerminated: noop,
    settings: { backgroundColor: "#000000", fitMode: "screen", readingMode: "single", readingDirection: "ltr", swipeDirection: "rtl", wheelDirection: "down", pageOffset: 0, pageTransition: "none", preloadCount: 2 },
  };
  render(<PdfViewer {...props} />);
  expect(pdf).toHaveBeenLastCalledWith(expect.objectContaining({ readingDirection: "ltr", swipeDirection: "rtl" }));
});
