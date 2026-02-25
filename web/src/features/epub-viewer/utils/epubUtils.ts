export interface ProgressInput {
  percentage?: number;
  index?: number;
  spineLength: number;
}

/**
 * EpubJS의 locations.generate() 전후에 관계없이 일관된 진행도를 계산함
 * percentage가 있으면 이를 우선 사용하고, 없으면 spine index 기반으로 추정함
 */
export function calculateGlobalProgress(input: ProgressInput): number {
  const { percentage, index = 0, spineLength } = input;

  if (percentage !== undefined && percentage > 0) {
    return percentage;
  }

  // percentage가 0이거나 없을 때 spine index 기반 추정 (최소한의 가시성 보장)
  if (spineLength <= 0) return 0.001; // 최소값 보장

  // spine 인덱스를 기반으로 대략적인 위치 계산
  // 부광님 요청: 첫 번째 챕터(index 0)라도 '읽기 시작'했으므로 0보다는 큰 값을 반환하여
  // 시리즈 페이지에서 0%로 떨어지지 않게 함 (최소 0.1% 보장)
  const estimated = index / spineLength;
  return Math.max(0.001, estimated);
}

/**
 * 현재 페이지 번호와 전체 페이지 번호를 기반으로 한 퍼센트 계산 (fallback용)
 */
export function calculatePercentageFromPages(currentPage: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return Math.min(1, Math.max(0, currentPage / totalPages));
}
