import type { Series, Volume, ReadingProgress, SeriesProgressSummary } from "../types/series";

export interface ProgressDisplayData {
  percent: number;
  label: string;
}

/**
 * 시리즈 또는 볼륨의 진행 상태를 기반으로 퍼센트와 라벨을 계산함
 */
export function calculateProgressDisplay(params: {
  type: "series" | "volume";
  series: Series;
  volume?: Volume;
  progress?: ReadingProgress;
  summary?: SeriesProgressSummary;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ProgressDisplayData {
  const { type, series, volume, progress, summary, t } = params;
  const isVolumeType = type === "volume";

  // 1. 퍼센트 계산 로직
  let percent = 0;
  if (isVolumeType) {
    if (volume) {
      if (volume.is_completed) {
        percent = 100;
      } else if (volume.total_page_count && volume.total_page_count > 0) {
        // 일반 도서 (이미지/PDF): 전체 페이지 수 기반 계산
        percent = Math.min(100, ((volume.read_page_count || 0) / volume.total_page_count) * 100);
      } else if (progress) {
        // EPUB 도서: total_page_count가 0이므로 progress_percent(0~100) 직접 사용
        percent = Math.min(100, Math.max(0, progress.progress_percent));
      }
    }
  } else {
    if (series.total_page_count && series.total_page_count > 0) {
      // 일반 시리즈: 전체 페이지 수 기반 합산 계산
      percent = Math.min(100, Math.max(0, ((series.read_page_count || 0) / series.total_page_count) * 100));
    } else if (summary?.total_volumes && summary.current_volume_number >= 0) {
      // 볼륨 단위 진행도 (챕터 정보 부족 시 가이드용)
      percent = Math.min(100, (summary.current_volume_number / summary.total_volumes) * 100);
    } else if (progress) {
      // EPUB 시리즈: progress_percent 직접 사용
      percent = Math.min(100, Math.max(0, progress.progress_percent));
    }
  }

  // 2. 라벨 생성 로직
  let label = t("series.info.not_read");
  if (isVolumeType) {
    if (volume) {
      if (volume.is_completed) {
        label = t("series.info.completed");
      } else if (volume.total_page_count && volume.total_page_count > 0) {
        label = `${volume.read_page_count || 0} / ${volume.total_page_count} P`;
      } else if (progress) {
        label = `${progress.current_page} / ${progress.total_pages} P`;
      }
    }
  } else {
    if (series.total_page_count && series.total_page_count > 0) {
      const p = Math.floor(percent);
      label = `${p}% (${series.read_page_count || 0} / ${series.total_page_count} P)`;
    } else if (summary?.total_pages && summary.total_pages > 0) {
      const p = Math.floor(((summary.read_pages || 0) / summary.total_pages) * 100);
      label = `${p}% (${summary.read_pages || 0} / ${summary.total_pages} P)`;
    } else if (summary?.total_volumes) {
      label = `${summary.current_volume_number} / ${summary.total_volumes} ${t("series.unit.volume", { count: 1 }).replace(/\d+/, "").trim()}`;
    } else if (progress) {
      label = `${progress.current_page} / ${progress.total_pages} P`;
    }
  }

  return { percent, label };
}
