import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useScanStore } from "../stores/scanStore";
import styles from "./ScanProgressBar.module.css";

export function ScanProgressBar() {
  const { scanningLibraries, isScanning, startPolling, checkScanStatus } = useScanStore();

  // 컴포넌트 마운트 시 초기 상태 체크
  useEffect(() => {
    checkScanStatus();
  }, [checkScanStatus]);

  // 스캔 시작 시 폴링 시작
  useEffect(() => {
    if (isScanning) {
      startPolling();
    }
  }, [isScanning, startPolling]);

  // 스캔 중이 아니면 렌더링하지 않음
  if (!isScanning || scanningLibraries.length === 0) {
    return null;
  }

  // 전체 진행률 계산 (여러 라이브러리의 평균)
  const totalProgress = scanningLibraries.reduce((sum, lib) => sum + (lib.progress || 0), 0) / scanningLibraries.length;

  return (
    <div className={styles.scanProgressContainer}>
      <div
        className={styles.scanProgressBar}
        style={{ width: `${Math.max(totalProgress, 5)}%` }}
      />

      {/* 호버 시 표시되는 툴팁 */}
      <div className={styles.scanTooltip}>
        <div className={styles.tooltipTitle}>
          <span className={styles.tooltipIcon}>
            <Loader2 size={14} />
          </span>
          스캔 진행 중...
        </div>

        {scanningLibraries.map((lib) => (
          <div
            key={lib.id}
            className={styles.libraryItem}
          >
            <div className={styles.libraryName}>{lib.name}</div>
            {lib.currentItem && <div className={styles.currentItem}>📁 {lib.currentItem}</div>}
            <div className={styles.progressWrapper}>
              <div className={styles.progressBarSmall}>
                <div
                  className={styles.progressBarFill}
                  style={{ width: `${lib.progress || 0}%` }}
                />
              </div>
              <span className={styles.progressText}>{lib.progress || 0}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
