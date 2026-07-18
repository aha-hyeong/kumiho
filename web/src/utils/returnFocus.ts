export type ReturnFocusScope = "library" | "series";

const STORAGE_PREFIX = "kumiho:return-focus";

function getStorageKey(scope: ReturnFocusScope, parentId: string) {
  return `${STORAGE_PREFIX}:${scope}:${parentId}`;
}

/**
 * Remembers the card that initiated a detail-page navigation so that returning
 * to its parent collection can put that card back in view exactly once.
 */
export function rememberReturnFocus(scope: ReturnFocusScope, parentId: string, itemId: string) {
  try {
    window.sessionStorage.setItem(getStorageKey(scope, parentId), itemId);
  } catch {
    // Browsers may block storage in private or restrictive contexts.
  }
}

/** Returns and clears a pending focus target for this exact parent route. */
export function takeReturnFocus(scope: ReturnFocusScope, parentId: string) {
  try {
    const key = getStorageKey(scope, parentId);
    const itemId = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    return itemId;
  } catch {
    return null;
  }
}

/**
 * 뷰어에서 시리즈 또는 볼륨 경로로 나갈 때 시리즈 페이지의
 * 복귀 스크롤 대상을 마지막으로 읽은 볼륨으로 갱신합니다.
 */
export function rememberViewerReturnFocus(
  viewerFrom: string | undefined,
  seriesId: string | null | undefined,
  volumeId: string | null | undefined,
) {
  if (!viewerFrom || !seriesId || !volumeId) return;
  if (!/^\/(?:series|volumes)\/[^/?#]+(?:[/?#]|$)/.test(viewerFrom)) return;

  rememberReturnFocus("series", seriesId, volumeId);
}
