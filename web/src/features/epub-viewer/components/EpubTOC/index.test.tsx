import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { EpubTOC } from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("EpubTOC", () => {
  it("닫기 X 버튼이 존재하고 클릭 시 onClose를 호출한다", () => {
    const onClose = vi.fn();
    render(
      <EpubTOC
        toc={[]}
        onItemClick={vi.fn()}
        onClose={onClose}
      />,
    );

    const closeButton = screen.getByLabelText("epub_viewer.toc.close");
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
