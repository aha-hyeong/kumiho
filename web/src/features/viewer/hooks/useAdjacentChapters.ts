// 인접 챕터 탐색 훅

import { useEffect, useState, useCallback } from "react";
import { volumeAPI, seriesAPI } from "../../../api/client";
import type { Chapter, Volume, AdjacentChapterInfo } from "../types";

interface UseAdjacentChaptersParams {
  volumeId: string | null;
  chapterId: string | undefined;
  seriesId: string | null;
}

/**
 * 이전/다음 챕터 정보를 탐색하는 커스텀 훅
 * - 같은 볼륨 내 인접 챕터 확인
 * - 다른 볼륨으로 넘어가는 경우도 처리
 */
export function useAdjacentChapters({ volumeId, chapterId, seriesId }: UseAdjacentChaptersParams): AdjacentChapterInfo {
  const [nextChapterId, setNextChapterId] = useState<string | null>(null);
  const [prevChapterId, setPrevChapterId] = useState<string | null>(null);
  const [nextChapterTitle, setNextChapterTitle] = useState<string | null>(null);
  const [prevChapterTitle, setPrevChapterTitle] = useState<string | null>(null);
  const [isLastChapterOfVolume, setIsLastChapterOfVolume] = useState(false);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const currentKey = volumeId && chapterId && seriesId ? `${volumeId}:${chapterId}:${seriesId}` : null;

  // 다른 볼륨의 챕터 가져오기
  const fetchAdjacentVolumeChapter = useCallback(
    async (targetSeriesId: string, currentVolumeId: string, direction: "next" | "prev"): Promise<boolean> => {
      try {
        const volumesRes = await seriesAPI.getVolumes(targetSeriesId);
        const volumes = volumesRes.data.volumes.sort((a: Volume, b: Volume) => a.volume_number - b.volume_number);
        const currentVolIndex = volumes.findIndex((v: Volume) => v.id === currentVolumeId);

        if (direction === "prev") {
          if (currentVolIndex > 0) {
            const prevVol = volumes[currentVolIndex - 1];
            // 이전 볼륨의 마지막 챕터 가져오기
            const chaptersRes = await volumeAPI.getChapters(prevVol.id);
            const chapters = chaptersRes.data.chapters.sort(
              (a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number,
            );
            if (chapters.length > 0) {
              const lastChapter = chapters[chapters.length - 1];
              setPrevChapterId(lastChapter.id);
              // 볼륨 제목과 챕터 제목이 같으면 챕터 제목만 표시
              const title =
                prevVol.title !== lastChapter.title ? `${prevVol.title} - ${lastChapter.title}` : lastChapter.title;
              setPrevChapterTitle(title);
            }
          }
        } else {
          if (currentVolIndex < volumes.length - 1) {
            const nextVol = volumes[currentVolIndex + 1];
            // 다음 볼륨의 첫 챕터 가져오기
            const chaptersRes = await volumeAPI.getChapters(nextVol.id);
            const chapters = chaptersRes.data.chapters.sort(
              (a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number,
            );
            if (chapters.length > 0) {
              const firstChapter = chapters[0];
              setNextChapterId(firstChapter.id);
              // 볼륨 제목과 챕터 제목이 같으면 챕터 제목만 표시
              const title =
                nextVol.title !== firstChapter.title ? `${nextVol.title} - ${firstChapter.title}` : firstChapter.title;
              setNextChapterTitle(title);
            }
          }
        }
        return true;
      } catch (err: unknown) {
        console.warn(`인접 볼륨(${direction}) 로드 실패:`, err);
        return false;
      }
    },
    [],
  );

  // 인접 챕터 로드
  const loadAdjacentChapters = useCallback(
    async (targetVolumeId: string, currentChapterId: string, targetSeriesId: string) => {
      try {
        // 1. 현재 볼륨의 챕터 목록 조회
        const chaptersRes = await volumeAPI.getChapters(targetVolumeId);
        const chapters = chaptersRes.data.chapters.sort(
          (a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number,
        );
        const currentIndex = chapters.findIndex((c: Chapter) => c.id === currentChapterId);

        // 같은 볼륨 내 이전/다음 챕터 확인
        if (currentIndex > 0) {
          const prev = chapters[currentIndex - 1];
          setPrevChapterId(prev.id);
          setPrevChapterTitle(prev.title);
        } else {
          // 볼륨의 첫 챕터 -> 이전 볼륨 확인
          setPrevChapterId(null);
          setPrevChapterTitle(null);
          const loaded = await fetchAdjacentVolumeChapter(targetSeriesId, targetVolumeId, "prev");
          if (!loaded) return false;
        }

        if (currentIndex < chapters.length - 1) {
          const next = chapters[currentIndex + 1];
          setNextChapterId(next.id);
          setNextChapterTitle(next.title);
          setIsLastChapterOfVolume(false);
        } else {
          // 볼륨의 마지막 챕터 -> 다음 볼륨 확인
          setNextChapterId(null);
          setNextChapterTitle(null);
          setIsLastChapterOfVolume(true); // 마지막 챕터임을 표시
          const loaded = await fetchAdjacentVolumeChapter(targetSeriesId, targetVolumeId, "next");
          if (!loaded) return false;
        }
        return true;
      } catch (err) {
        console.error("인접 챕터 로드 실패:", err);
        return false;
      }
    },
    [fetchAdjacentVolumeChapter],
  );

  // volumeId, chapterId, seriesId가 변경되면 인접 챕터 로드
  useEffect(() => {
    let cancelled = false;
    const requestKey = currentKey;

    const load = async () => {
      if (!requestKey || !volumeId || !chapterId || !seriesId) {
        if (!cancelled) {
          setResolvedKey(null);
        }
        return;
      }

      const success = await loadAdjacentChapters(volumeId, chapterId, seriesId);
      if (cancelled) return;

      setResolvedKey(success ? requestKey : null);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [volumeId, chapterId, seriesId, loadAdjacentChapters, currentKey]);

  return {
    nextChapterId,
    prevChapterId,
    nextChapterTitle,
    prevChapterTitle,
    isLastChapterOfVolume,
    isAdjacentResolved: currentKey !== null && resolvedKey === currentKey,
  };
}
