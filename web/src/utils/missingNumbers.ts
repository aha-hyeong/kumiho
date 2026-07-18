export interface NumberRange {
  start: number;
  end: number;
}

/**
 * 등록된 양의 정수 번호 사이에서 비어 있는 번호를 연속 범위로 찾습니다.
 * 첫 등록 번호 앞이나 마지막 등록 번호 뒤의 번호는 추정하지 않습니다.
 */
export function findMissingNumberRanges(numbers: number[]): NumberRange[] {
  const sorted = [...new Set(numbers.filter((number) => Number.isInteger(number) && number > 0))].sort((a, b) => a - b);
  const ranges: NumberRange[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (current - previous > 1) {
      ranges.push({ start: previous + 1, end: current - 1 });
    }
  }

  return ranges;
}

/** 누락 범위를 각 번호의 단위 표기로 펼쳐 반환합니다. */
export function formatMissingNumberRanges(ranges: NumberRange[], unit: string): string {
  return ranges
    .flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, index) => `${start + index}${unit}`))
    .join(", ");
}
