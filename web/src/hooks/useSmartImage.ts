import { useState, useEffect, useRef } from "react";
import type { SyntheticEvent } from "react";

const LOADING_OPACITY = 0.7;
const TRANSITION_STYLE = "opacity 0.2s ease-in-out";

/**
 * 이미지 로딩, 레이스 컨디션 방지, 그리고 다음 이미지 프리로딩을 관리하는 커스텀 훅
 */
export function useSmartImage(
  src: string,
  nextSrc?: string,
  onLoad?: (e: SyntheticEvent<HTMLImageElement> | Event) => void,
) {
  const [displaySrc, setDisplaySrc] = useState<string>(src);
  const [isLoading, setIsLoading] = useState(false);
  const currentSrcRef = useRef(src);
  const onLoadRef = useRef(onLoad);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    if (src === currentSrcRef.current) {
      return;
    }
    currentSrcRef.current = src;
    setIsLoading(true);

    const img = new Image();
    img.src = src;

    img.onload = (e) => {
      if (src === currentSrcRef.current) {
        setDisplaySrc(src);
        setIsLoading(false);
        onLoadRef.current?.(e);
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
