import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * 라우트 변경 시 항상 최상단으로 스크롤하는 컴포넌트
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
