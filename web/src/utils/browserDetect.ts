/**
 * 브라우저 감지 유틸리티
 * 구형 브라우저에서 기능 제한이 필요한 경우 사용
 */

/**
 * iOS Safari 15 이하 여부를 감지한다.
 * epub.js iframe 내부 터치 이벤트가 동작하지 않는 문제 대응용.
 * 추후 전체 Safari로 확장 시 버전 체크만 제거하면 된다.
 */
export function isOldIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;

  // iOS 판별: iPhone, iPad, iPod (iPad는 iOS 13+에서 Mac으로 위장하므로 maxTouchPoints도 체크)
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (!isIOS) return false;

  // iOS 버전 추출 (예: "CPU iPhone OS 15_8 like Mac OS X" → 15)
  const versionMatch = ua.match(/OS (\d+)[_\d]* like Mac OS X/);
  if (versionMatch) {
    const majorVersion = parseInt(versionMatch[1], 10);
    return majorVersion <= 15;
  }

  // iPad가 Mac으로 위장하는 경우 버전 추출 불가 → Safari임은 확실하나 버전 모름
  // 안전하게 true 반환 (터치 fallback 적용)
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
    return true;
  }

  return false;
}
