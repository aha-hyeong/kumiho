import { create } from "zustand";
import { libraryAPI } from "../api/client";
import { useLibraryStore } from "./libraryStore";

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
}

interface ScanStore {
  // 스캔 중인 라이브러리들
  scanningLibraries: LibraryScanStatus[];
  // 전체 스캔 여부
  isScanning: boolean;
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
  pollingInterval: null,

  checkScanStatus: async () => {
    try {
      const response = await libraryAPI.getAll();
      const libraries = response.data.libraries || response.data || [];

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

      const wasScanning = get().isScanning;
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

      // 스캔 중인 항목이 변경되었을 때 화면 갱신 트리거
      if (isNowScanning && prevItems !== currentItems) {
        useLibraryStore.getState().triggerRefresh();
      }

      // 스캔이 완료되면 폴링 중지 및 최종 화면 갱신
      if (wasScanning && !isNowScanning) {
        useLibraryStore.getState().triggerRefresh();
        get().stopPolling();
      }
    } catch (error) {
      console.error("Failed to check scan status:", error);
    }
  },

  startPolling: () => {
    const { pollingInterval } = get();
    if (pollingInterval) return; // 이미 폴링 중

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
      set({ pollingInterval: null });
    }
  },
}));
