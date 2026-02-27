import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EpubViewer } from "../../../pages/EpubViewer";
import { MemoryRouter } from "react-router-dom";

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("EpubViewer UI", () => {
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
      fontFamily: "sans-serif",
      lineHeight: 1.5,
      theme: "light" as const,
      flow: "paginated" as const,
      spread: "auto" as const,
      wheelDirection: "down" as const,
      keyboardDirection: "right" as const,
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
    onWheelDirectionChange: vi.fn(),
    onKeyboardDirectionChange: vi.fn(),
    onSpreadChange: vi.fn(),
  };

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

  it("should display correct progress percentage", () => {
    render(
      <MemoryRouter>
        <EpubViewer
          {...defaultProps}
          globalProgress={45.6}
        />
      </MemoryRouter>,
    );

    // 반올림되어 46%로 표시되는지 확인
    expect(screen.getByText("(46%)")).toBeInTheDocument();
  });
});
