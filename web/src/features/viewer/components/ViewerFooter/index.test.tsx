import type React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { ViewerFooter } from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; label?: string }) => {
      const base = opts?.defaultValue ?? key;
      return base.replace("{{label}}", opts?.label ?? "");
    },
  }),
}));

vi.mock("../../../../api/client", () => ({
  seriesAPI: {
    updateViewerSettings: vi.fn(),
  },
}));

function renderFooter(override: Partial<React.ComponentProps<typeof ViewerFooter>> = {}) {
  const props: React.ComponentProps<typeof ViewerFooter> = {
    currentPage: 10,
    totalPages: 100,
    isUIVisible: true,
    readingMode: "single",
    pageOffset: 0,
    seriesId: null,
    nextChapterId: null,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onGoToPage: vi.fn(),
    onPageJumpClick: vi.fn(),
    onReadingModeChange: vi.fn(),
    onTogglePageOffset: vi.fn(),
    ...override,
  };

  const result = render(<ViewerFooter {...props} />);
  return { ...result, props };
}

describe("ViewerFooter", () => {
  it("진행바 클릭 시 비율에 맞는 페이지로 이동", () => {
    const { props } = renderFooter();
    const slider = screen.getByRole("slider");
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 100,
      height: 14,
      right: 100,
      bottom: 14,
      toJSON: () => ({}),
    });
    Object.defineProperty(slider, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(slider, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(slider, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 50 });
    expect(props.onGoToPage).toHaveBeenCalledWith(51);
  });

  it("마커 hover 시 라벨/페이지 툴팁 표시", () => {
    renderFooter({
      tocMarkers: [{ id: "m1", page: 30, label: "Chapter 1" }],
    });

    const marker = document.querySelector<HTMLButtonElement>("button[title='Chapter 1']");
    expect(marker).toBeTruthy();
    if (!marker) return;
    fireEvent.mouseEnter(marker);

    expect(screen.getByText("Chapter 1")).toBeInTheDocument();
    expect(screen.getByText("30 P")).toBeInTheDocument();
  });

  it("onMarkerJump 이 있으면 마커 클릭 시 우선 호출", () => {
    const onMarkerJump = vi.fn();
    const { props } = renderFooter({
      tocMarkers: [{ id: "m1", page: 20, label: "Part A" }],
      onMarkerJump,
    });

    const marker = document.querySelector<HTMLButtonElement>("button[title='Part A']");
    expect(marker).toBeTruthy();
    if (!marker) return;
    fireEvent.click(marker);

    expect(onMarkerJump).toHaveBeenCalledTimes(1);
    expect(onMarkerJump).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", page: 20, label: "Part A" }));
    expect(props.onGoToPage).not.toHaveBeenCalled();
  });
});
