import { create } from "zustand";
import { libraryAPI } from "../api/client";
import { useLibraryStore } from "./libraryStore";

const IDLE_POLL_LIMIT = 60;
const PENDING_POLL_LIMIT = 180;

interface LibraryScanSnapshot {
  lastScanResult: string;
  lastScannedAt: string;
}

// 라이브러리 스캔 상태 타입
interface LibraryScanStatus {
  id: string;
  name: string;
  scanStatus: string; // "IDLE" | "SCANNING" | "ERROR"
  lastScanResult: string; // "시리즈명|진행률" 형식
  currentItem?: string;
  progress?: number;
}

// API 응답 라이브러리 타입
interface LibraryResponse {
  id: string;
  name: string;
  scan_status: string;
  last_scan_result: string;
  last_scanned_at?: string | null;
}

interface ScanStore {
  // 스캔 중인 라이브러리들
  scanningLibraries: LibraryScanStatus[];
  // 전체 스캔 여부
  isScanning: boolean;
  // 스캔이 한 번이라도 시작된 적이 있는지
  hasObservedScanning: boolean;
  // 스캔 미감지 폴링 횟수
  idlePollCount: number;
  // 스캔 시작 전 대기 폴링 횟수
  pendingPollCount: number;
  // 폴링 시작 시점의 스캔 결과 스냅샷
  scanSnapshot: Record<string, LibraryScanSnapshot> | null;
  // 폴링 인터벌 ID
  pollingInterval: ReturnType<typeof setInterval> | null;

  // 스캔 상태 체크
  checkScanStatus: () => Promise<void>;
  // 폴링 시작
  startPolling: () => void;
  // 폴링 중지
  stopPolling: () => void;
}

export const useScanStore = create<ScanStore>((set, get) => ({
  scanningLibraries: [],
  isScanning: false,
  hasObservedScanning: false,
  idlePollCount: 0,
  pendingPollCount: 0,
  scanSnapshot: null,
  pollingInterval: null,

  checkScanStatus: async () => {
    try {
      const response = await libraryAPI.getAll();
      const libraries = response.data.libraries || response.data || [];
      const currentSnapshot = buildScanSnapshot(libraries);

      // 스캔 중인 라이브러리 필터링
      const scanning: LibraryScanStatus[] = libraries
        .filter((lib: LibraryResponse) => lib.scan_status === "SCANNING")
        .map((lib: LibraryResponse) => {
          // last_scan_result 파싱: "시리즈명|진행률" 형식
          let currentItem = "";
          let progress = 0;
          if (lib.last_scan_result && lib.last_scan_result.includes("|")) {
            const parts = lib.last_scan_result.split("|");
            currentItem = parts[0] || "";
            progress = parseInt(parts[1], 10) || 0;
          }

          return {
            id: lib.id,
            name: lib.name,
            scanStatus: lib.scan_status,
            lastScanResult: lib.last_scan_result,
            currentItem,
            progress,
          };
        });

      const {
        isScanning: wasScanning,
        pollingInterval,
        idlePollCount,
        pendingPollCount,
        hasObservedScanning,
        scanSnapshot,
      } = get();
      const isNowScanning = scanning.length > 0;

      // 이전 스캔 항목들 추출
      const prevItems = get()
        .scanningLibraries.map((lib) => lib.currentItem)
        .join(",");
      // 현재 스캔 항목들 추출
      const currentItems = scanning.map((lib) => lib.currentItem).join(",");

      set({
        scanningLibraries: scanning,
        isScanning: isNowScanning,
      });

      if (!scanSnapshot) {
        set({ scanSnapshot: currentSnapshot });
      }

      // 스캔 중인 항목이 변경되었을 때 화면 갱신 트리거
      if (isNowScanning && prevItems !== currentItems) {
        useLibraryStore.getState().triggerRefresh();
      }

      // 스캔이 완료되면 폴링 중지 및 최종 화면 갱신
      if (wasScanning && !isNowScanning && hasObservedScanning) {
        useLibraryStore.getState().triggerRefresh();
        get().stopPolling();
        return;
      }

      if (isNowScanning) {
        set({ idlePollCount: 0, pendingPollCount: 0, hasObservedScanning: true });
        return;
      }

      const hasScanCompletionSignal = Boolean(
        scanSnapshot && hasSnapshotChanged(scanSnapshot, currentSnapshot),
      );
      if (pollingInterval && !hasObservedScanning && hasScanCompletionSignal) {
        useLibraryStore.getState().triggerRefresh();
        get().stopPolling();
        return;
      }

      if (!pollingInterval) {
        return;
      }

      if (hasObservedScanning) {
        const nextIdlePollCount = idlePollCount + 1;
        if (nextIdlePollCount >= IDLE_POLL_LIMIT) {
          get().stopPolling();
        } else {
          set({ idlePollCount: nextIdlePollCount });
        }
        return;
      }

      const nextPendingPollCount = pendingPollCount + 1;
      if (nextPendingPollCount >= PENDING_POLL_LIMIT) {
        get().stopPolling();
      } else {
        set({ pendingPollCount: nextPendingPollCount });
      }
    } catch (error) {
      console.error("Failed to check scan status:", error);
    }
  },

  startPolling: () => {
    const { pollingInterval } = get();
    if (pollingInterval) return; // 이미 폴링 중

    set({ idlePollCount: 0, pendingPollCount: 0, hasObservedScanning: false, scanSnapshot: null });

    // 즉시 한 번 체크
    get().checkScanStatus();

    // 1초마다 폴링
    const interval = setInterval(() => {
      get().checkScanStatus();
    }, 1000);

    set({ pollingInterval: interval });
  },

  stopPolling: () => {
    const { pollingInterval } = get();
    if (pollingInterval) {
      clearInterval(pollingInterval);
      set({
        pollingInterval: null,
        idlePollCount: 0,
        pendingPollCount: 0,
        hasObservedScanning: false,
        scanSnapshot: null,
      });
    }
  },
}));

function buildScanSnapshot(libraries: LibraryResponse[]): Record<string, LibraryScanSnapshot> {
  return libraries.reduce<Record<string, LibraryScanSnapshot>>((snapshot, lib) => {
    snapshot[lib.id] = {
      lastScanResult: lib.last_scan_result ?? "",
      lastScannedAt: lib.last_scanned_at ?? "",
    };
    return snapshot;
  }, {});
}

function hasSnapshotChanged(
  previousSnapshot: Record<string, LibraryScanSnapshot>,
  currentSnapshot: Record<string, LibraryScanSnapshot>,
): boolean {
  const previousIds = Object.keys(previousSnapshot);
  const currentIds = Object.keys(currentSnapshot);
  if (previousIds.length !== currentIds.length) {
    return true;
  }

  return currentIds.some((id) => {
    const previous = previousSnapshot[id];
    const current = currentSnapshot[id];
    if (!previous || !current) {
      return true;
    }

    return previous.lastScanResult !== current.lastScanResult || previous.lastScannedAt !== current.lastScannedAt;
  });
}
