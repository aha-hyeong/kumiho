import type { ViewerSwipeSettings } from "../types/series";

export class ViewerSwipeContractError extends Error {
  constructor() {
    super("뷰어 설정 API 버전이 맞지 않습니다 (swipe_settings contract mismatch). 서버 업데이트 후 새로고침해 주세요.");
    this.name = "ViewerSwipeContractError";
  }
}

const isDirection = (value: unknown): value is "ltr" | "rtl" => value === "ltr" || value === "rtl";

export function assertViewerSwipeSettings(value: unknown): asserts value is ViewerSwipeSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ViewerSwipeContractError();
  }
  const settings = value as Partial<ViewerSwipeSettings>;
  if (!isDirection(settings.user_default) || !isDirection(settings.effective_direction) ||
    !(settings.series_override === null || isDirection(settings.series_override)) ||
    settings.effective_direction !== (settings.series_override ?? settings.user_default)) {
    throw new ViewerSwipeContractError();
  }
}
