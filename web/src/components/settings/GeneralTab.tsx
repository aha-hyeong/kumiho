import { useState, useEffect, useRef } from "react";
import { Languages, Monitor, Loader2, Check, AlertCircle } from "lucide-react";
import { useViewerStore, type ReadingMode, type ReadingDirection, type FitMode } from "../../stores/viewerStore";
import { settingsAPI } from "../../api/client";
import styles from "./SettingsComponents.module.css";

interface SettingsData {
  app_language?: string;
  viewer_reading_mode?: string;
  viewer_reading_direction?: string;
  viewer_click_direction?: string;
  viewer_keyboard_direction?: string;
  viewer_fit_mode?: string;
  [key: string]: string | undefined;
}

export function GeneralTab() {
  const { settings, setReadingMode, setReadingDirection, setClickDirection, setKeyboardDirection, setFitMode } =
    useViewerStore();
  const [language, setLanguage] = useState("ko");
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 상태 메시지 자동 제거 타이머 관리
  useEffect(() => {
    if (status) {
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
      statusTimerRef.current = setTimeout(() => {
        setStatus(null);
        statusTimerRef.current = null;
      }, 3000);
    }
    return () => {
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
    };
  }, [status]);

  // 설정 가져오기
  useEffect(() => {
    let isMounted = true;
    const fetchSettings = async () => {
      try {
        const response = await settingsAPI.getAll();
        if (!isMounted) return;

        const data = response.data as SettingsData;

        // 런타임 타입 검증 강화
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          throw new Error("Invalid response format: expected an object");
        }

        if (typeof data.app_language === "string") setLanguage(data.app_language);
        if (data.viewer_reading_mode) setReadingMode(data.viewer_reading_mode as ReadingMode);
        if (data.viewer_reading_direction) setReadingDirection(data.viewer_reading_direction as ReadingDirection);
        if (data.viewer_click_direction) setClickDirection(data.viewer_click_direction as ReadingDirection);
        if (data.viewer_keyboard_direction) setKeyboardDirection(data.viewer_keyboard_direction as ReadingDirection);
        if (data.viewer_fit_mode) setFitMode(data.viewer_fit_mode as FitMode);
      } catch (error) {
        if (isMounted) {
          console.error("Failed to fetch settings:", error);
          setStatus({ type: "error", message: "설정을 불러오는데 실패했습니다." });
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchSettings();
    return () => {
      isMounted = false;
    };
  }, [setReadingMode, setReadingDirection, setClickDirection, setKeyboardDirection, setFitMode]);

  // 설정 업데이트 핸들러
  const handleSettingChange = async (key: string, value: string, updateFn?: (val: string) => void) => {
    try {
      await settingsAPI.update(key, value);

      if (updateFn) {
        updateFn(value);
      } else if (key === "app_language") {
        setLanguage(value);
      }
      setStatus({ type: "success", message: "설정이 저장되었습니다." });
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      setStatus({ type: "error", message: "설정 저장에 실패했습니다." });
    }
  };

  if (isLoading) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.placeholderContent}>
          <Loader2
            className={styles.loadingSpinner}
            size={24}
          />
          <p>설정을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.tabContent} ${styles.relative}`}>
      {status && (
        <div
          role={status.type === "error" ? "alert" : "status"}
          aria-live={status.type === "error" ? "assertive" : "polite"}
          className={`${styles.statusMessage} ${status.type === "success" ? styles.success : styles.error}`}
        >
          {status.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
          {status.message}
        </div>
      )}
      <div className={styles.tabHeader}>
        <h2>일반 설정</h2>
        <p className={styles.tabDescription}>애플리케이션 언어 및 뷰어 기본 설정을 관리합니다.</p>
      </div>

      <div className={styles.settingsSections}>
        {/* 언어 설정 */}
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Languages size={18} />
            <h3>언어 설정</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="app_language">기본 언어</label>
                <p>애플리케이션에 표시될 언어를 선택하세요.</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="app_language"
                  value={language}
                  onChange={(e) => handleSettingChange("app_language", e.target.value)}
                  className={styles.settingsSelect}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* 전역 뷰어 설정 */}
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Monitor size={18} />
            <h3>전역 뷰어 기본값</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_reading_mode">기본 보기 모드</label>
                <p>뷰어 시작 시 기본으로 적용될 페이지 보기 방식을 선택합니다.</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_reading_mode"
                  value={settings.readingMode}
                  onChange={(e) =>
                    handleSettingChange("viewer_reading_mode", e.target.value, (v) => setReadingMode(v as ReadingMode))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="single">한 페이지 보기</option>
                  <option value="double">두 페이지 보기</option>
                  <option value="vertical">세로 스크롤</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_reading_direction">읽기 방향</label>
                <p>페이지가 넘어가는 기본 방향을 설정합니다.</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_reading_direction"
                  value={settings.readingDirection}
                  onChange={(e) =>
                    handleSettingChange("viewer_reading_direction", e.target.value, (v) =>
                      setReadingDirection(v as ReadingDirection),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="ltr">왼쪽에서 오른쪽 (LTR)</option>
                  <option value="rtl">오른쪽에서 왼쪽 (RTL)</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_click_direction">다음 페이지 클릭</label>
                <p>화면 클릭 시 다음 페이지로 이동할 방향을 설정합니다.</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_click_direction"
                  value={settings.clickDirection}
                  onChange={(e) =>
                    handleSettingChange("viewer_click_direction", e.target.value, (v) =>
                      setClickDirection(v as ReadingDirection),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="ltr">오른쪽 클릭</option>
                  <option value="rtl">왼쪽 클릭</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_keyboard_direction">다음 페이지 키보드</label>
                <p>키보드 화살표 입력 시 다음 페이지로 이동할 방향을 설정합니다.</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_keyboard_direction"
                  value={settings.keyboardDirection}
                  onChange={(e) =>
                    handleSettingChange("viewer_keyboard_direction", e.target.value, (v) =>
                      setKeyboardDirection(v as ReadingDirection),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="ltr">오른쪽 화살표</option>
                  <option value="rtl">왼쪽 화살표</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_fit_mode">이미지 맞춤</label>
                <p>뷰어에서 이미지를 화면에 맞추는 기본 방식을 설정합니다.</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_fit_mode"
                  value={settings.fitMode}
                  onChange={(e) =>
                    handleSettingChange("viewer_fit_mode", e.target.value, (v) => setFitMode(v as FitMode))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="screen">화면에 맞춤</option>
                  <option value="width">가로폭에 맞춤</option>
                  <option value="height">세로 높이에 맞춤</option>
                  <option value="original">원본 크기</option>
                </select>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
