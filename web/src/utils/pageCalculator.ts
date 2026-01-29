import type { ReadingMode } from "../stores/viewerStore";
import type { PageMeta } from "../features/viewer/types";

interface PageCalculationParams {
  currentPage: number;
  totalPages: number;
  readingMode: ReadingMode;
  pageOffset: number;
  pageMetaMap: Map<number, PageMeta>;
}

// 현재 화면에 표시할 페이지 번호 배열 계산
export const getDisplayPages = ({
  currentPage,
  totalPages,
  readingMode,
  pageOffset,
  pageMetaMap,
}: PageCalculationParams): number[] => {
  if (readingMode === "vertical") {
    // 세로 모드는 한 번에 모든 페이지 렌더링 (또는 가상화)
    // 뷰어 컴포넌트에서 처리하므로 여기서는 빈 배열 혹은 전체 배열 리턴
    // (VerticalPage 로직은 별도이므로 여기서는 Single/Double 위주로 처리)
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (readingMode === "single") {
    return [currentPage];
  }

  // Double 모드 로직
  // 오프셋 1일 때 1페이지는 단독 표시 (표지)
  if (pageOffset === 1 && currentPage === 1) {
    return [1];
  }

  // Wide 페이지 감지 (현재 페이지가 Wide면 단독 표시)
  const currentMeta = pageMetaMap.get(currentPage);
  if (currentMeta?.isWide) {
    return [currentPage];
  }

  let startPage = currentPage;

  // 오프셋 보정: 짝수/홀수 시작점 맞춤
  if (pageOffset === 0) {
    if (startPage % 2 === 0) startPage--;
  } else {
    if (startPage % 2 !== 0) startPage--;
  }

  if (startPage < 1) startPage = 1;

  // 시작 페이지가 Wide면 단독 표시
  const startMeta = pageMetaMap.get(startPage);
  if (startMeta?.isWide && startPage !== currentPage) {
    return [currentPage];
  }

  // 다음 페이지가 Wide인지 확인
  const nextMeta = pageMetaMap.get(startPage + 1);
  if (nextMeta?.isWide) {
    // 다음 장이 Wide인데 현재 페이지가 짝수(왼쪽)라면, 오른쪽을 비워두거나 Wide를 위해 넘겨야 함?
    // 기존 로직: Wide 페이지는 무조건 단독 뷰.
    // 만약 startPage가 현재 페이지라면 그대로 단독 렌더링.
    if (startPage + 1 === currentPage) {
      return [currentPage];
    }
    // startPage만 보여줌
    return [startPage];
  }

  const pages = [startPage];
  if (startPage + 1 <= totalPages) {
    pages.push(startPage + 1);
  }

  return pages;
};

// 이전 페이지로 이동했을 때의 "기준 페이지 번호" 계산
// (단순 -1이 아니라, Double 모드에서는 -2가 될 수도 있고 Wide 페이지 변수 등 고려)
// 이전 페이지로 이동했을 때의 "기준 페이지 번호" 계산
// (단순 -1이 아니라, Double 모드에서는 -2가 될 수도 있고 Wide 페이지 변수 등 고려)
export const getPrevTargetPage = (
  currentPage: number,
  readingMode: ReadingMode,
  pageMetaMap: Map<number, PageMeta>,
): number => {
  if (currentPage <= 1) return -1; // 이동 불가

  if (readingMode === "vertical") return currentPage - 1; // 세로 모드는 스크롤이라 의미 없음, 단순 리턴
  if (readingMode === "single") return currentPage - 1;

  // Double Mode
  const prevPage = currentPage - 1;
  const prevMeta = pageMetaMap.get(prevPage);

  // 바로 이전 장이 Wide이면 그 Wide 장을 하나의 뷰로 보여주도록 prevPage로 이동
  if (prevPage >= 1 && prevMeta?.isWide) {
    return prevPage;
  }

  // 바로 이전 장이 Wide가 아니면, 일반적인 Double 모드 이동 (2페이지 전)
  // 단, 2페이지 전으로 갔을 때 0 이하로 떨어지면 1로 보정
  const step = 2;
  return Math.max(1, currentPage - step);
};

// 다음 페이지로 이동했을 때의 "기준 페이지 번호" 계산
export const getNextTargetPage = (
  currentPage: number,
  totalPages: number,
  readingMode: ReadingMode,
  pageMetaMap: Map<number, PageMeta>,
): number => {
  if (currentPage >= totalPages) return -1; // 이동 불가

  if (readingMode === "vertical") return currentPage + 1;
  if (readingMode === "single") return currentPage + 1;

  // Double Mode
  // 현재 페이지가 Wide라면 다음 장으로 1칸만 이동 (Wide는 한 화면을 차지하므로)
  const currentMeta = pageMetaMap.get(currentPage);
  if (currentMeta?.isWide) {
    return currentPage + 1;
  }

  // 일반적인 경우 2페이지 이동
  // 단, 다음 페이지(currentPage + 1)가 Wide라면?
  // Double 모드 렌더링 로직상 currentPage + 2로 이동해버리면 Wide 페이지(currentPage+1)를 건너뛸 수 있음.
  // 따라서 다음 장이 Wide인지 체크
  const nextPage = currentPage + 1;
  const nextMeta = pageMetaMap.get(nextPage);

  if (nextMeta?.isWide) {
    // 다음 장이 Wide라면 1칸만 이동하여 그 Wide 페이지를 보여줌
    return nextPage;
  }

  // 기본 2칸 이동 (범위 초과 시 totalPages로 제한하지 않고, Viewer 로직 일관성을 위해 계산값 반환하되 호출처에서 range check)
  // 하지만 여기서는 "Target Page"를 구하는 것이므로 유효한 페이지여야 함.
  const target = currentPage + 2;
  return target > totalPages ? totalPages : target;
};
