import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { EpubSettingsPanel } from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("EpubSettingsPanel", () => {
  it("닫기 X 버튼이 존재하고 클릭 시 onClose를 호출한다", () => {
    const onClose = vi.fn();
    render(
      <EpubSettingsPanel
        settings={{
          fontSize: 100,
          fontFamily: "sans-serif",
          lineHeight: 1.5,
          theme: "light",
          renderMode: "auto",
          flow: "paginated",
          spread: "auto",
          wheelDirection: "down",
          keyboardDirection: "right",
          clickDirection: "right",
        }}
        onFontSizeChange={vi.fn()}
        onFontFamilyChange={vi.fn()}
        onLineHeightChange={vi.fn()}
        onThemeChange={vi.fn()}
        onRenderModeChange={vi.fn()}
        onWheelDirectionChange={vi.fn()}
        onKeyboardDirectionChange={vi.fn()}
        onClickDirectionChange={vi.fn()}
        onClose={onClose}
      />,
    );

    const closeButton = screen.getByLabelText("common.close");
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
