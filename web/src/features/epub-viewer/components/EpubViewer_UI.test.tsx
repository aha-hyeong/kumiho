import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EpubViewer } from "../../../pages/EpubViewer";
import { MemoryRouter } from "react-router-dom";

const isOldIOSSafariMock = vi.hoisted(() => vi.fn(() => false));
const viewerNextSpy = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const viewerPrevSpy = vi.hoisted(() => vi.fn().mockResolvedValue(true));

const goToCFISpy = vi.fn();
const goToProgressSpy = vi.fn();

vi.mock("../../../utils/browserDetect", () => ({
  isOldIOSSafari: isOldIOSSafariMock,
  isSafari: vi.fn(() => false),
}));

vi.mock("../../../features/epub-viewer/components/EpubChapterViewer", async () => {
  const React = await import("react");

  const MockEpubChapterViewer = React.forwardRef((_props: unknown, ref: React.ForwardedRef<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      next: viewerNextSpy,
      prev: viewerPrevSpy,
      goToCFI: goToCFISpy,
      goToProgress: goToProgressSpy,
      goToPage: vi.fn(),
    }));
    return <div data-testid="mock-epub-chapter-viewer" />;
  });

  return { EpubChapterViewer: MockEpubChapterViewer };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function createDefaultProps() {
  return {
    chapterTitle: "Test Chapter",
    chapterId: "c1",
    epubUrl: "test.epub",
    initialCFI: null,
    currentPage: 1,
    totalPages: 10,
    visiblePage: 1,
    visibleTotalPages: 10,
    globalProgress: 0,
    isUIVisible: true,
    isSettingsOpen: false,
    isTOCOpen: false,
    isFullscreen: false,
    isIncognito: false,
    isAtFirstPage: false,
    isAtLastPage: false,
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
    onCloseSettings: vi.fn(),
    onToggleTOC: vi.fn(),
    onCloseTOC: vi.fn(),
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
    onFlowChange: vi.fn(),
    onWheelDirectionChange: vi.fn(),
    onKeyboardDirectionChange: vi.fn(),
    onClickDirectionChange: vi.fn(),
    onSpreadChange: vi.fn(),
  };
}

function getMain(container: HTMLElement): HTMLElement {
  const main = container.querySelector("main");
  expect(main).not.toBeNull();
  return main as HTMLElement;
}

function touchStart(target: Element, x: number, y: number) {
  fireEvent.touchStart(target, {
    touches: [{ clientX: x, clientY: y }],
    changedTouches: [{ clientX: x, clientY: y }],
  });
}

function touchMove(target: Element, x: number, y: number) {
  fireEvent.touchMove(target, {
    changedTouches: [{ clientX: x, clientY: y }],
  });
}

function touchEnd(target: Element, x: number, y: number) {
  fireEvent.touchEnd(target, {
    changedTouches: [{ clientX: x, clientY: y }],
  });
}

describe("EpubViewer UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerNextSpy.mockResolvedValue(true);
    viewerPrevSpy.mockResolvedValue(true);
    isOldIOSSafariMock.mockReturnValue(false);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const estimatedToc = [
    {
      id: "toc-1",
      label: "Chapter 1",
      href: "chapter-1.xhtml",
      progressRatio: 0.25,
      progressPrecision: "estimated" as const,
    },
    {
      id: "toc-2",
      label: "Chapter 2",
      href: "chapter-2.xhtml",
      progressRatio: 0.5,
      progressPrecision: "estimated" as const,
    },
    {
      id: "toc-3",
      label: "Chapter 3",
      href: "chapter-3.xhtml",
      progressRatio: 0.75,
      progressPrecision: "estimated" as const,
    },
  ];

  const preciseToc = [
    {
      id: "toc-1",
      label: "Chapter 1",
      href: "chapter-1.xhtml",
      progressRatio: 0.2,
      progressPrecision: "precise" as const,
    },
    {
      id: "toc-2",
      label: "Chapter 2",
      href: "chapter-2.xhtml",
      progressRatio: 0.45,
      progressPrecision: "precise" as const,
    },
    {
      id: "toc-3",
      label: "Chapter 3",
      href: "chapter-3.xhtml",
      progressRatio: 0.8,
      progressPrecision: "precise" as const,
    },
  ];

  it("should display 0% progress in the footer when globalProgress is 0", () => {
    const props = createDefaultProps();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          globalProgress={0}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("| 0%")).toBeInTheDocument();
  });

  it("should display progress percentage from unified position axis", () => {
    const props = createDefaultProps();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          currentPage={6}
          totalPages={11}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("| 50%")).toBeInTheDocument();
  });

  it("should render epub view mode dropdown in settings panel", () => {
    const props = createDefaultProps();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          isSettingsOpen
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("epub_viewer.settings.render_mode.label")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "epub_viewer.settings.render_mode.auto" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "epub_viewer.settings.render_mode.book" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "epub_viewer.settings.render_mode.comic" })).toBeInTheDocument();
  });

  it("should render estimated chapter markers on progress bar", () => {
    const props = createDefaultProps();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          toc={estimatedToc}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTitle("Chapter 1")).toBeInTheDocument();
    expect(screen.getByTitle("Chapter 2")).toBeInTheDocument();
    expect(screen.getByTitle("Chapter 3")).toBeInTheDocument();
    expect(screen.queryByTitle("페이지 계산중...")).not.toBeInTheDocument();
  });

  it("should render precise chapter markers on progress bar", () => {
    const props = createDefaultProps();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          toc={preciseToc}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTitle("Chapter 1")).toBeInTheDocument();
    expect(screen.getByTitle("Chapter 2")).toBeInTheDocument();
    expect(screen.getByTitle("Chapter 3")).toBeInTheDocument();
  });

  it("should navigate to toc target when chapter marker is clicked", () => {
    const props = createDefaultProps();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          toc={preciseToc}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTitle("Chapter 2"));

    expect(goToCFISpy).toHaveBeenCalledWith("chapter-2.xhtml");
    expect(goToProgressSpy).not.toHaveBeenCalled();
  });

  it("should move on progress bar background click", () => {
    const props = createDefaultProps();

    render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const progressBar = document.querySelector("[class*='progressBarInteractive']");
    expect(progressBar).not.toBeNull();
    fireEvent.click(progressBar as Element, { clientX: 200 });

    expect(goToProgressSpy).toHaveBeenCalled();
    expect(goToCFISpy).not.toHaveBeenCalled();
  });

  it("should hide spinner when toc markers are precise", () => {
    const props = createDefaultProps();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          toc={preciseToc}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTitle("페이지 계산중...")).not.toBeInTheDocument();
  });

  it("should toggle UI on center tap in old iOS Safari", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const props = createDefaultProps();
    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);
    touchStart(main, 500, 200);
    touchEnd(main, 500, 200);

    expect(props.onViewerClick).toHaveBeenCalledTimes(1);
    expect(viewerNextSpy).not.toHaveBeenCalled();
    expect(viewerPrevSpy).not.toHaveBeenCalled();
  });

  it("should navigate correctly on left and right tap zones in paginated mode", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const props = createDefaultProps();
    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);

    touchStart(main, 100, 200);
    touchEnd(main, 100, 200);
    touchStart(main, 900, 200);
    touchEnd(main, 900, 200);

    expect(viewerPrevSpy).toHaveBeenCalledTimes(1);
    expect(viewerNextSpy).toHaveBeenCalledTimes(1);
  });

  it("should keep center click UI toggle in scrolled mode", () => {
    const baseProps = createDefaultProps();
    const props = {
      ...baseProps,
      settings: {
        ...baseProps.settings,
        flow: "scrolled" as const,
      },
    };

    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);

    fireEvent.click(main, { clientX: 500 });

    expect(props.onViewerClick).toHaveBeenCalledTimes(1);
    expect(viewerPrevSpy).not.toHaveBeenCalled();
    expect(viewerNextSpy).not.toHaveBeenCalled();
  });

  it("should ignore left and right click zones in scrolled mode", () => {
    const baseProps = createDefaultProps();
    const props = {
      ...baseProps,
      settings: {
        ...baseProps.settings,
        flow: "scrolled" as const,
      },
    };

    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);

    fireEvent.click(main, { clientX: 100 });
    fireEvent.click(main, { clientX: 900 });

    expect(viewerPrevSpy).not.toHaveBeenCalled();
    expect(viewerNextSpy).not.toHaveBeenCalled();
    expect(props.onViewerClick).not.toHaveBeenCalled();
  });

  it("should invert left and right tap navigation when clickDirection is left", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const baseProps = createDefaultProps();
    const props = {
      ...baseProps,
      settings: {
        ...baseProps.settings,
        clickDirection: "left" as const,
      },
    };

    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);

    touchStart(main, 100, 200);
    touchEnd(main, 100, 200);
    touchStart(main, 900, 200);
    touchEnd(main, 900, 200);

    expect(viewerNextSpy).toHaveBeenCalledTimes(1);
    expect(viewerPrevSpy).toHaveBeenCalledTimes(1);
  });

  it("should navigate next on horizontal swipe left in old iOS Safari", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const props = createDefaultProps();

    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);

    touchStart(main, 700, 200);
    touchMove(main, 580, 205);
    touchEnd(main, 580, 205);

    expect(viewerNextSpy).toHaveBeenCalledTimes(1);
    expect(viewerPrevSpy).not.toHaveBeenCalled();
    expect(props.onViewerClick).not.toHaveBeenCalled();
  });

  it("should ignore synthetic click within 500ms after touch", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T00:00:00Z"));
    isOldIOSSafariMock.mockReturnValue(true);
    const props = createDefaultProps();

    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);

    touchStart(main, 500, 200);
    touchEnd(main, 500, 200);
    expect(props.onViewerClick).toHaveBeenCalledTimes(1);

    fireEvent.click(main, { clientX: 500 });
    expect(props.onViewerClick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(501);
    fireEvent.click(main, { clientX: 500 });
    expect(props.onViewerClick).toHaveBeenCalledTimes(2);
  });

  it("should not handle touch fallback when browser is not old iOS Safari", () => {
    isOldIOSSafariMock.mockReturnValue(false);
    const props = createDefaultProps();

    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);

    touchStart(main, 500, 200);
    touchEnd(main, 500, 200);

    expect(props.onViewerClick).not.toHaveBeenCalled();
    expect(viewerNextSpy).not.toHaveBeenCalled();
    expect(viewerPrevSpy).not.toHaveBeenCalled();
  });

  it("should ignore touches on settings panel targets in old iOS Safari", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const props = createDefaultProps();

    const { container } = render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          isSettingsOpen
        />
      </MemoryRouter>,
    );

    const main = getMain(container);
    const blocked = document.createElement("div");
    blocked.setAttribute("data-epub-settings", "");
    main.appendChild(blocked);

    touchStart(blocked, 500, 200);
    touchEnd(blocked, 500, 200);

    expect(props.onViewerClick).not.toHaveBeenCalled();
    expect(viewerNextSpy).not.toHaveBeenCalled();
    expect(viewerPrevSpy).not.toHaveBeenCalled();
  });

  it("should ignore touches on toc panel targets in old iOS Safari", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const props = createDefaultProps();

    const { container } = render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          isTOCOpen
        />
      </MemoryRouter>,
    );

    const main = getMain(container);
    const blocked = document.createElement("div");
    blocked.setAttribute("data-epub-toc", "");
    main.appendChild(blocked);

    touchStart(blocked, 500, 200);
    touchEnd(blocked, 500, 200);

    expect(props.onViewerClick).not.toHaveBeenCalled();
    expect(viewerNextSpy).not.toHaveBeenCalled();
    expect(viewerPrevSpy).not.toHaveBeenCalled();
  });

  it("should ignore touches on elements matched by header/footer guard inside main", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const props = createDefaultProps();

    const { container } = render(
      <MemoryRouter>
        <EpubViewer {...props} />
      </MemoryRouter>,
    );

    const main = getMain(container);
    const blockedHeader = document.createElement("header");
    const blockedFooter = document.createElement("footer");
    main.appendChild(blockedHeader);
    main.appendChild(blockedFooter);

    touchStart(blockedHeader, 500, 80);
    touchEnd(blockedHeader, 500, 80);
    touchStart(blockedFooter, 500, 730);
    touchEnd(blockedFooter, 500, 730);

    expect(props.onViewerClick).not.toHaveBeenCalled();
    expect(viewerNextSpy).not.toHaveBeenCalled();
    expect(viewerPrevSpy).not.toHaveBeenCalled();
  });

  it("should call onReachedEndNext when viewer.next reports no movement", async () => {
    const props = createDefaultProps();
    const onReachedEndNext = vi.fn();
    viewerNextSpy.mockResolvedValue(false);

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          visiblePage={10}
          visibleTotalPages={10}
          onReachedEndNext={onReachedEndNext}
          isEndNavigationReady
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("epub_viewer.footer.next_page"));

    await waitFor(() => {
      expect(onReachedEndNext).toHaveBeenCalledTimes(1);
    });
    expect(viewerNextSpy).toHaveBeenCalledTimes(1);
  });

  it("should keep next navigation disabled when end navigation is not ready", () => {
    const props = createDefaultProps();
    const onReachedEndNext = vi.fn();
    viewerNextSpy.mockResolvedValue(false);

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          visiblePage={10}
          visibleTotalPages={10}
          onReachedEndNext={onReachedEndNext}
          isEndNavigationReady={false}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("epub_viewer.footer.next_page"));

    expect(viewerNextSpy).not.toHaveBeenCalled();
    expect(onReachedEndNext).not.toHaveBeenCalled();
  });

  it("should call viewer.next when movement succeeds", async () => {
    const props = createDefaultProps();
    const onReachedEndNext = vi.fn();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          currentPage={10}
          totalPages={10}
          visiblePage={9}
          visibleTotalPages={10}
          onReachedEndNext={onReachedEndNext}
          isEndNavigationReady
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("epub_viewer.footer.next_page"));

    await waitFor(() => {
      expect(viewerNextSpy).toHaveBeenCalledTimes(1);
    });
    expect(onReachedEndNext).not.toHaveBeenCalled();
  });

  it("should not open end flow before the visible last page even when progress is 100%", async () => {
    const props = createDefaultProps();
    const onReachedEndNext = vi.fn();

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          currentPage={10}
          totalPages={10}
          visiblePage={14}
          visibleTotalPages={16}
          globalProgress={100}
          onReachedEndNext={onReachedEndNext}
          isEndNavigationReady
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("epub_viewer.footer.next_page"));

    await waitFor(() => {
      expect(viewerNextSpy).toHaveBeenCalledTimes(1);
    });
    expect(onReachedEndNext).not.toHaveBeenCalled();
  });

  it("should open end flow only when the visible last page can no longer move", async () => {
    const props = createDefaultProps();
    const onReachedEndNext = vi.fn();
    viewerNextSpy.mockResolvedValue(false);

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          visiblePage={16}
          visibleTotalPages={16}
          onReachedEndNext={onReachedEndNext}
          isEndNavigationReady
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("epub_viewer.footer.next_page"));

    await waitFor(() => {
      expect(onReachedEndNext).toHaveBeenCalledTimes(1);
    });
    expect(viewerNextSpy).toHaveBeenCalledTimes(1);
  });

  it("should call onReachedEndNext when viewer.next fails even if isAtLastPage is false", async () => {
    const props = createDefaultProps();
    const onReachedEndNext = vi.fn();
    viewerNextSpy.mockResolvedValue(false);

    render(
      <MemoryRouter>
        <EpubViewer
          {...props}
          onReachedEndNext={onReachedEndNext}
          isEndNavigationReady
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("epub_viewer.footer.next_page"));

    await waitFor(() => {
      expect(onReachedEndNext).toHaveBeenCalledTimes(1);
    });
    expect(viewerNextSpy).toHaveBeenCalledTimes(1);
  });
});
