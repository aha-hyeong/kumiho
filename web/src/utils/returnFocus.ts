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
