import { useState, useEffect, useRef } from "react";

const LOADING_OPACITY = 0.7;
const TRANSITION_STYLE = "opacity 0.2s ease-in-out";

/**
 * 이미지 로딩, 레이스 컨디션 방지, 그리고 다음 이미지 프리로딩을 관리하는 커스텀 훅
 */
export function useSmartImage(src: string, nextSrc?: string) {
  const [displaySrc, setDisplaySrc] = useState<string>(src);
  const [isLoading, setIsLoading] = useState(false);
  const currentSrcRef = useRef(src);

  useEffect(() => {
    if (src === currentSrcRef.current) {
      return;
    }
    currentSrcRef.current = src;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);

    const img = new Image();
    img.src = src;

    img.onload = () => {
      if (src === currentSrcRef.current) {
        setDisplaySrc(src);
        setIsLoading(false);
      }
    };

    img.onerror = () => {
      if (src === currentSrcRef.current) {
        setDisplaySrc(src);
        setIsLoading(false);
      }
    };
  }, [src]);

  useEffect(() => {
    if (!nextSrc) return;
    const img = new Image();
    img.src = nextSrc;
    return () => {
      img.src = "";
    };
  }, [nextSrc]);

  return { displaySrc, isLoading, LOADING_OPACITY, TRANSITION_STYLE };
}
