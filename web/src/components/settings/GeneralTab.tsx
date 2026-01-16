import { useState, useEffect } from "react";
import { Languages, Monitor, Loader2, Check, AlertCircle } from "lucide-react";
import { useViewerStore, type ReadingMode, type ReadingDirection, type FitMode } from "../../stores/viewerStore";
import { settingsAPI } from "../../api/client";

export function GeneralTab() {
  const { settings, setReadingMode, setReadingDirection, setFitMode } = useViewerStore();
  const [language, setLanguage] = useState("ko");
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // 설정 가져오기
  // 초기 로딩 시 서버 설정을 우선하여 로컬 스토어(localStorage)와 동기화합니다.
  // 이는 기기 간 설정 일관성을 보장하기 위함입니다.
  useEffect(() => {
    let isMounted = true;
    const fetchSettings = async () => {
      try {
        const response = await settingsAPI.getAll();
        if (!isMounted) return;

        const data = response.data;
        // Type safety check
        if (typeof data !== "object" || data === null) {
          throw new Error("Invalid response format");
        }

        if (data.app_language) setLanguage(data.app_language);
        if (data.viewer_reading_mode) setReadingMode(data.viewer_reading_mode as ReadingMode);
        if (data.viewer_reading_direction) setReadingDirection(data.viewer_reading_direction as ReadingDirection);
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
  }, [setReadingMode, setReadingDirection, setFitMode]);

  // 설정 업데이트 핸들러
  const handleSettingChange = async (key: string, value: string, updateFn?: (val: string) => void) => {
    try {
      // 1. API 업데이트
      await settingsAPI.update(key, value);

      // 2. 로컬 상태/스토어 업데이트
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
      <div className="tab-content">
        <div className="placeholder-content">
          <Loader2
            className="animate-spin"
            size={24}
          />
          <p>설정을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content relative">
      {status && (
        <div
          className={`absolute top-0 right-0 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-2 ${
            status.type === "success"
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-red-500/20 text-red-400 border border-red-500/30"
          }`}
        >
          {status.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
          {status.message}
        </div>
      )}
      <div className="tab-header">
        <h2>일반 설정</h2>
        <p className="tab-description">애플리케이션 언어 및 뷰어 기본 설정을 관리합니다.</p>
      </div>

      <div className="settings-sections">
        {/* 언어 설정 */}
        <section className="settings-section">
          <div className="section-title">
            <Languages size={18} />
            <h3>언어 설정</h3>
          </div>
          <div className="section-content">
            <div className="settings-item">
              <div className="item-info">
                <label htmlFor="app_language">기본 언어</label>
                <p>애플리케이션에 표시될 언어를 선택하세요.</p>
              </div>
              <div className="item-control">
                <select
                  id="app_language"
                  value={language}
                  onChange={(e) => handleSettingChange("app_language", e.target.value)}
                  className="settings-select"
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
        <section className="settings-section">
          <div className="section-title">
            <Monitor size={18} />
            <h3>전역 뷰어 기본값</h3>
          </div>
          <div className="section-content">
            <div className="settings-item">
              <div className="item-info">
                <label htmlFor="viewer_reading_mode">기본 보기 모드</label>
                <p>뷰어 시작 시 기본으로 적용될 페이지 보기 방식을 선택합니다.</p>
              </div>
              <div className="item-control">
                <select
                  id="viewer_reading_mode"
                  value={settings.readingMode}
                  onChange={(e) =>
                    handleSettingChange("viewer_reading_mode", e.target.value, (v) => setReadingMode(v as ReadingMode))
                  }
                  className="settings-select"
                >
                  <option value="single">한 페이지 보기</option>
                  <option value="double">두 페이지 보기</option>
                  <option value="vertical">세로 스크롤</option>
                </select>
              </div>
            </div>

            <div className="settings-item">
              <div className="item-info">
                <label htmlFor="viewer_reading_direction">읽기 방향</label>
                <p>페이지가 넘어가는 기본 방향을 설정합니다.</p>
              </div>
              <div className="item-control">
                <select
                  id="viewer_reading_direction"
                  value={settings.readingDirection}
                  onChange={(e) =>
                    handleSettingChange("viewer_reading_direction", e.target.value, (v) =>
                      setReadingDirection(v as ReadingDirection)
                    )
                  }
                  className="settings-select"
                >
                  <option value="ltr">왼쪽에서 오른쪽 (LTR)</option>
                  <option value="rtl">오른쪽에서 왼쪽 (RTL)</option>
                </select>
              </div>
            </div>

            <div className="settings-item">
              <div className="item-info">
                <label htmlFor="viewer_fit_mode">이미지 맞춤</label>
                <p>뷰어에서 이미지를 화면에 맞추는 기본 방식을 설정합니다.</p>
              </div>
              <div className="item-control">
                <select
                  id="viewer_fit_mode"
                  value={settings.fitMode}
                  onChange={(e) =>
                    handleSettingChange("viewer_fit_mode", e.target.value, (v) => setFitMode(v as FitMode))
                  }
                  className="settings-select"
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
