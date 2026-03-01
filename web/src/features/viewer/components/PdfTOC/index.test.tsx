import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { PdfTOC } from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("PdfTOC", () => {
  it("오버레이 바깥 클릭 시 닫힌다", () => {
    const onClose = vi.fn();
    render(
      <PdfTOC
        isOpen
        onClose={onClose}
        onJump={vi.fn()}
        currentPage={1}
        items={[
          {
            title: "Chapter 1",
            pageNumber: 1,
            items: [],
          },
        ]}
      />,
    );

    const overlay = document.querySelector("[aria-hidden='false']");
    expect(overlay).toBeTruthy();
    if (!overlay) return;

    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("패널 내부 클릭은 닫히지 않고, 항목 클릭 시 onJump 호출", () => {
    const onClose = vi.fn();
    const onJump = vi.fn();
    render(
      <PdfTOC
        isOpen
        onClose={onClose}
        onJump={onJump}
        currentPage={1}
        items={[
          {
            title: "Chapter 1",
            pageNumber: 10,
            items: [],
          },
        ]}
      />,
    );

    const tocButton = screen.getByRole("button", { name: /chapter 1/i });
    fireEvent.click(tocButton);

    expect(onJump).toHaveBeenCalledWith(10);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("닫기 X 버튼이 존재하고 클릭 시 onClose를 호출한다", () => {
    const onClose = vi.fn();
    render(
      <PdfTOC
        isOpen
        onClose={onClose}
        onJump={vi.fn()}
        currentPage={1}
        items={[]}
      />,
    );

    const closeButton = screen.getByLabelText("viewer.toc.close");
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
