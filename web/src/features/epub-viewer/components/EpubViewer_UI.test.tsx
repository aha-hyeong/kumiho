import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EpubViewer } from "../../../pages/EpubViewer";
import { MemoryRouter } from "react-router-dom";

const goToCFISpy = vi.fn();
const goToProgressSpy = vi.fn();

vi.mock("../../../features/epub-viewer/components/EpubChapterViewer", async () => {
  const React = await import("react");

  const MockEpubChapterViewer = React.forwardRef((_props: unknown, ref: React.ForwardedRef<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      next: vi.fn(),
      prev: vi.fn(),
      goToCFI: goToCFISpy,
      goToProgress: goToProgressSpy,
      goToPage: vi.fn(),
    }));
    return <div data-testid="mock-epub-chapter-viewer" />;
  });

  return { EpubChapterViewer: MockEpubChapterViewer };
});

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("EpubViewer UI", () => {
  beforeEach(() => {
    goToCFISpy.mockReset();
    goToProgressSpy.mockReset();
  });

  const defaultProps = {
    chapterTitle: "Test Chapter",
    chapterId: "c1",
    epubUrl: "test.epub",
    initialCFI: null,
    currentCFI: null,
    currentPage: 1,
    totalPages: 10,
    globalProgress: 0,
    isUIVisible: true,
    isSettingsOpen: false,
    isTOCOpen: false,
    isFullscreen: false,
    isIncognito: false,
    toc: [],
    settings: {
      fontSize: 100,
      fontFamily: "sans-serif" as const,
      lineHeight: 1.5,
      theme: "light" as const,
      renderMode: "auto" as const,
      flow: "paginated" as const,
      spread: "auto" as const,
      wheelDirection: "down" as const,
      keyboardDirection: "right" as const,
      clickDirection: "right" as const,
    },
    onBack: vi.fn(),
    onToggleSettings: vi.fn(),
    onToggleTOC: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onReady: vi.fn(),
    onTOCLoad: vi.fn(),
    onLocationChange: vi.fn(),
    onViewerClick: vi.fn(),
    onFontSizeChange: vi.fn(),
    onFontFamilyChange: vi.fn(),
    onLineHeightChange: vi.fn(),
    onThemeChange: vi.fn(),
    onRenderModeChange: vi.fn(),
    onWheelDirectionChange: vi.fn(),
    onKeyboardDirectionChange: vi.fn(),
    onClickDirectionChange: vi.fn(),
    onSpreadChange: vi.fn(),
  };

  const estimatedToc = [
    { id: "toc-1", label: "Chapter 1", href: "chapter-1.xhtml", progressRatio: 0.25, progressPrecision: "estimated" as const },
    { id: "toc-2", label: "Chapter 2", href: "chapter-2.xhtml", progressRatio: 0.5, progressPrecision: "estimated" as const },
    { id: "toc-3", label: "Chapter 3", href: "chapter-3.xhtml", progressRatio: 0.75, progressPrecision: "estimated" as const },
  ];

  const preciseToc = [
    { id: "toc-1", label: "Chapter 1", href: "chapter-1.xhtml", progressRatio: 0.2, progressPrecision: "precise" as const },
    { id: "toc-2", label: "Chapter 2", href: "chapter-2.xhtml", progressRatio: 0.45, progressPrecision: "precise" as const },
    { id: "toc-3", label: "Chapter 3", href: "chapter-3.xhtml", progressRatio: 0.8, progressPrecision: "precise" as const },
  ];

  it("should display 0% progress in the footer when globalProgress is 0", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
          globalProgress={0}
        />
      </MemoryRouter>,
    );

    // 하단바의 % 표시 확인
    expect(screen.getByText("(0%)")).toBeInTheDocument();
  });

  it("should display progress percentage from unified position axis", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
          currentPage={6}
          totalPages={11}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("(50%)")).toBeInTheDocument();
  });

  it("should render epub view mode dropdown in settings panel", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
          isSettingsOpen
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("epub_viewer.settings.render_mode.label")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "epub_viewer.settings.render_mode.auto" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "epub_viewer.settings.render_mode.book" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "epub_viewer.settings.render_mode.comic" })).toBeInTheDocument();
  });

  it("should not render estimated chapter markers on progress bar", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
          toc={estimatedToc}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: /epub_viewer\.progress_marker\.navigate/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle("페이지 계산중...")).not.toBeInTheDocument();
  });

  it("should render precise chapter markers on progress bar", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
          toc={preciseToc}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTitle("Chapter 1")).toBeInTheDocument();
    expect(screen.getByTitle("Chapter 2")).toBeInTheDocument();
    expect(screen.getByTitle("Chapter 3")).toBeInTheDocument();
  });

  it("should navigate to toc target when chapter marker is clicked", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
          toc={preciseToc}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTitle("Chapter 2"));

    expect(goToCFISpy).toHaveBeenCalledWith("chapter-2.xhtml");
    expect(goToProgressSpy).not.toHaveBeenCalled();
  });

  it("should move on progress bar background click", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
        />
      </MemoryRouter>,
    );

    const progressBar = document.querySelector("[class*='progressBarInteractive']");
    expect(progressBar).not.toBeNull();
    fireEvent.click(progressBar as Element, { clientX: 200 });

    expect(goToProgressSpy).toHaveBeenCalled();
    expect(goToCFISpy).not.toHaveBeenCalled();
  });

  it("should hide spinner when toc markers are precise", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
          toc={preciseToc}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTitle("페이지 계산중...")).not.toBeInTheDocument();
  });
});
