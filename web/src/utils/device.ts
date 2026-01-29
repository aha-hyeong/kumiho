/**
 * Simple utility to detect if the current device is mobile/tablet.
 * Used for adjusting UI/UX for touch interactions.
 */
export const isMobile = (): boolean => {
  if (typeof window === "undefined") return false;

  const userAgent = navigator.userAgent || navigator.vendor || "";

  // Check consistent mobile check (regex covering most devices)
  if (
    /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(
      userAgent,
    )
  ) {
    return true;
  }

  // Fallback: Check screen width (typical mobile breakpoint)
  return window.innerWidth <= 768;
};
