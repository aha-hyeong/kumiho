export const getFullscreenElement = (): Element | null => {
  const doc = document as any;
  return (
    doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement || null
  );
};

export const enterFullscreen = (element: HTMLElement = document.documentElement): Promise<void> => {
  const el = element as any;
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  return Promise.reject(new Error("Fullscreen API not supported"));
};

export const exitFullscreen = (): Promise<void> => {
  const doc = document as any;
  if (doc.exitFullscreen) return doc.exitFullscreen();
  if (doc.webkitExitFullscreen) return doc.webkitExitFullscreen();
  if (doc.mozCancelFullScreen) return doc.mozCancelFullScreen();
  if (doc.msExitFullscreen) return doc.msExitFullscreen();
  return Promise.reject(new Error("Fullscreen API not supported"));
};

export const addFullscreenChangeListener = (callback: () => void) => {
  const events = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
  events.forEach((event) => document.addEventListener(event, callback));
  return () => {
    events.forEach((event) => document.removeEventListener(event, callback));
  };
};

export const isFullscreen = (): boolean => {
  return !!getFullscreenElement();
};
