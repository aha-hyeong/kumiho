// BGM 제어 훅

import { useEffect, useState, useRef } from "react";
import { volumeAPI, settingAPI } from "../../../api/client";
import type { BGMInfo } from "../types";

interface UseBGMParams {
  volumeId: string | null;
  chapterId: string | undefined;
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
export function useBGM({ volumeId, chapterId }: UseBGMParams): UseBGMReturn {
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

  // 오디오 제어 및 자동 재생 차단 대응 (iOS/iPadOS)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !bgmInfo?.exists || !bgmInfo.url) return;

    // 1. 설정이 꺼져 있으면 정지 후 종료
    if (!isBgmPlaying) {
      audio.pause();
      return;
    }

    let interactionListenersAdded = false;

    // 2. 사용자 상호작용 시 재생 시도 함수
    const attemptPlay = () => {
      if (audio.paused) {
        audio
          .play()
          .then(cleanupListeners)
          .catch((err) => {
            console.debug("BGM play on interaction still prevented:", err);
          });
      } else {
        cleanupListeners();
      }
    };

    function cleanupListeners() {
      if (interactionListenersAdded) {
        window.removeEventListener("click", attemptPlay);
        window.removeEventListener("touchstart", attemptPlay);
        interactionListenersAdded = false;
      }
    }

    // 3. 우선 자동 재생 시도
    audio
      .play()
      .then(cleanupListeners)
      .catch((err) => {
        if (err.name === "NotAllowedError") {
          // 자동 재생이 엔진(브라우저)에 의해 차단된 경우에만 리스너 등록
          console.warn("BGM autoplay prevented. Waiting for user interaction...");
          window.addEventListener("click", attemptPlay);
          window.addEventListener("touchstart", attemptPlay, { passive: true });
          interactionListenersAdded = true;
        } else {
          console.warn("BGM play error:", err);
        }
      });

    return () => {
      cleanupListeners();
    };
  }, [bgmInfo, isBgmPlaying]);

  return {
    bgmInfo,
    isBgmPlaying,
    setIsBgmPlaying,
    audioRef,
  };
}
