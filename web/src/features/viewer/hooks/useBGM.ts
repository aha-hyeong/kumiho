// BGM 제어 훅

import { useEffect, useState, useRef } from "react";
import { volumeAPI, settingAPI } from "../../../api/client";
import type { BGMInfo } from "../types";

interface UseBGMParams {
  volumeId: string | null;
  chapterId: string | undefined;
  isReady: boolean;
}

interface UseBGMReturn {
  bgmInfo: BGMInfo | null;
  isBgmPlaying: boolean;
  setIsBgmPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

/**
 * BGM 제어를 위한 커스텀 훅
 * - 볼륨별 BGM 정보 로드
 * - 전역 설정의 BGM 자동 재생 여부 확인
 * - 오디오 재생/정지 제어
 */
export function useBGM({ volumeId, chapterId, isReady }: UseBGMParams): UseBGMReturn {
  const [bgmInfo, setBgmInfo] = useState<BGMInfo | null>(null);
  const [isBgmPlaying, setIsBgmPlaying] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 볼륨(권)이 바뀌면 BGM 정보 로드
  useEffect(() => {
    if (volumeId) {
      volumeAPI
        .getBGM(volumeId)
        .then((res) => setBgmInfo(res.data))
        .catch((err) => console.warn("Failed to load BGM info:", err));
    }
  }, [volumeId]); // chapterId가 바뀌어도 volumeId가 같으면 재호출 안 함

  // 전역 설정에서 BGM 자동 재생 여부 확인
  useEffect(() => {
    const fetchGlobalBgmSetting = async () => {
      try {
        const settings = await settingAPI.list();
        // 문자열 "false"인 경우에만 끔 (기본값 true)
        const enabled = settings.bgm_enabled !== "false";
        setIsBgmPlaying(enabled);
      } catch (e) {
        console.warn("Failed to load global bgm setting", e);
      }
    };
    fetchGlobalBgmSetting();
  }, [chapterId]); // 챕터가 바뀌면(즉 다른 책으로 가면) 설정을 다시 확인

  // 최신 상태를 추적하기 위한 Ref (Stale Closure 방지)
  const isBgmPlayingRef = useRef(isBgmPlaying);
  useEffect(() => {
    isBgmPlayingRef.current = isBgmPlaying;
  }, [isBgmPlaying]);

  const isReadyRef = useRef(isReady);
  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  const bgmInfoRef = useRef(bgmInfo);
  useEffect(() => {
    bgmInfoRef.current = bgmInfo;
  }, [bgmInfo]);

  // 오디오 재생/정지 제어
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !bgmInfo?.exists || !bgmInfo.url || !isReady) return;

    if (!isBgmPlaying) {
      audio.pause();
      return;
    }

    // 자동 재생 시도
    audio.play().catch((err) => {
      if (err.name === "NotAllowedError") {
        console.warn("BGM autoplay prevented. Waiting for user interaction...");
      } else {
        console.warn("BGM play error:", err);
      }
    });
  }, [bgmInfo, isBgmPlaying, isReady]);

  // iOS/iPadOS/PC 자동 재생 차단 대응: 사용자 상호작용 리스너
  // 별도 useEffect로 분리하여 상태 변경 시 리스너가 cleanup되지 않도록 함
  // 첫 재생 성공(오디오 언락) 후 리스너 제거
  const unlockedRef = useRef(false);
  useEffect(() => {
    const attemptPlay = () => {
      if (unlockedRef.current) return;
      const audio = audioRef.current;
      if (!audio) return;

      // 설정에 의해 꺼져있거나, 아직 이미지가 준비되지 않았다면 시도하지 않음
      if (!isBgmPlayingRef.current || !isReadyRef.current) return;

      // 만약 아직 BGM 정보가 안 왔더라도, 빈 오디오를 play() 해두면
      // 나중에 src가 들어왔을 때 브라우저가 자동 재생을 허용할 가능성이 높음
      audio
        .play()
        .then(() => {
          // 재생 성공 (src가 있으면 노래가 나올 것이고, 없으면 그냥 언락됨)
          if (bgmInfoRef.current?.exists) {
            unlockedRef.current = true;
            window.removeEventListener("click", attemptPlay);
            window.removeEventListener("touchstart", attemptPlay);
            window.removeEventListener("mousedown", attemptPlay);
            window.removeEventListener("keydown", attemptPlay);
          }
        })
        .catch((err) => {
          // src가 없어서 에러난 경우(AbortError 등)는 계속 시도
          if (import.meta.env.DEV) console.log("[useBGM] Unlock attempt:", err.name);
        });
    };

    window.addEventListener("click", attemptPlay);
    window.addEventListener("touchstart", attemptPlay, { passive: true });
    window.addEventListener("mousedown", attemptPlay);
    window.addEventListener("keydown", attemptPlay);

    return () => {
      window.removeEventListener("click", attemptPlay);
      window.removeEventListener("touchstart", attemptPlay);
      window.removeEventListener("mousedown", attemptPlay);
      window.removeEventListener("keydown", attemptPlay);
    };
  }, []);

  return {
    bgmInfo,
    isBgmPlaying,
    setIsBgmPlaying,
    audioRef,
  };
}
