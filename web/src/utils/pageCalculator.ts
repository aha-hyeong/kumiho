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
export const getPrevTargetPage = (
  currentPage: number,
  readingMode: ReadingMode,
  pageOffset: number,
  pageMetaMap: Map<number, PageMeta>,
): number => {
  if (currentPage <= 1) return -1; // 이동 불가

  if (readingMode === "vertical") return currentPage - 1; // 세로 모드는 스크롤이라 의미 없음, 단순 리턴
  if (readingMode === "single") return currentPage - 1;

  // Double Mode
  // 현재 상태의 첫 페이지(startPage)를 구하고 그 이전 장으로 이동
  let startPage = currentPage;
  // (getDisplayPages 내부 로직 일부 재사용 - startPage 보정)
  const currentMeta = pageMetaMap.get(currentPage);
  if (currentMeta?.isWide) {
    // Wide 페이지였다면 바로 이전 장으로
    return currentPage - 1;
  }

  if (pageOffset === 0) {
    if (startPage % 2 === 0) startPage--;
  } else {
    if (startPage % 2 !== 0) startPage--;
  }

  // startPage가 1이면 더 이전은 없음 (커버 페이지인 경우 0이 나올 수 없음, 위에서 체크함)

  // 이전 장의 "대표 페이지"는 startPage - 1 이어야 함.
  // 근데 전 장이 Wide일 수도 있고 2장 쌍일 수도 있음.
  // "이전 페이지" 클릭 시 로직:
  // prevPage 핸들러: Math.max(currentPage - step, 1) -> step은 2 or 1
  // 여기서는 단순히 step만큼 뺀 값을 리턴하여, 그 페이지 기준으로 getDisplayPages를 돌리면 됨.

  // **주의**: Wide 페이지가 중간에 끼면 step=2로 점프 시 Wide 페이지를 건너뛰거나 겹칠 수 있음.
  // ViewerStore.ts의 prevPage 로직은 단순 -1/-2 임.
  // 정확한 로직:
  // 현재 페이지 구성이 2장(3,4)이라면 -> 이전은 (1,2) 혹은 (2-Wide)
  // 단순히 -2를 하면 1이 됨 -> (1,2) 렌더링. OK.
  // 만약 현재(3,4)인데 2가 Wide라면 -> 1로 이동 -> (1) 렌더링? 아니면 2로 이동?
  // 뷰어 스토어의 prevPage는 무조건 step(2)만큼 뺌. (Wide 처리 미흡할 수 있음)

  // 일단 스토어 로직과 동일하게 구현하여 "예상되는 이전 뷰"를 보여주는 것이 맞음.
  // 스토어 로직: newPage = currentPage - (double ? 2 : 1)

  const step = 2; // Double mode standard step
  return Math.max(1, currentPage - step);
};

// 다음 페이지로 이동했을 때의 "기준 페이지 번호" 계산
export const getNextTargetPage = (currentPage: number, totalPages: number, readingMode: ReadingMode): number => {
  if (currentPage >= totalPages) return -1; // 이동 불가

  if (readingMode === "vertical") return currentPage + 1;
  if (readingMode === "single") return currentPage + 1;

  // Double Mode
  const step = 2;
  return Math.min(totalPages, currentPage + step);
};
