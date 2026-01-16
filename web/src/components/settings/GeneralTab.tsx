import { useState, useEffect } from "react";
import { Languages, Monitor, Loader2 } from "lucide-react";
import { useViewerStore, type ReadingMode, type ReadingDirection, type FitMode } from "../../stores/viewerStore";
import { settingsAPI } from "../../api/client";

export function GeneralTab() {
  const { settings, setReadingMode, setReadingDirection, setFitMode } = useViewerStore();
  const [language, setLanguage] = useState("ko");
  const [isLoading, setIsLoading] = useState(true);

  // 설정 가져오기
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await settingsAPI.getAll();
        const data = response.data;

        if (data.app_language) setLanguage(data.app_language);
        if (data.viewer_reading_mode) setReadingMode(data.viewer_reading_mode as ReadingMode);
        if (data.viewer_reading_direction) setReadingDirection(data.viewer_reading_direction as ReadingDirection);
        if (data.viewer_fit_mode) setFitMode(data.viewer_fit_mode as FitMode);
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [setReadingMode, setReadingDirection, setFitMode]);

  // 설정 업데이트 핸들러
  const handleSettingChange = async (key: string, value: string, updateFn?: (val: any) => void) => {
    try {
      // 1. API 업데이트
      await settingsAPI.update(key, value);

      // 2. 로컬 상태/스토어 업데이트
      if (updateFn) {
        updateFn(value);
      } else if (key === "app_language") {
        setLanguage(value);
      }
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      // 에러 처리는 나중에 토스트 메시지 등으로 보강 가능
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
    <div className="tab-content">
      <div className="tab-header">
        <h2>일반 설정</h2>
        <p className="tab-description">애플리케이션 언어 및 뷰어기본 설정을 관리합니다.</p>
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
                <label>기본 언어</label>
                <p>애플리케이션에 표시될 언어를 선택하세요.</p>
              </div>
              <div className="item-control">
                <select
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
                <label>기본 보기 모드</label>
                <p>뷰어 시작 시 기본으로 적용될 페이지 보기 방식을 선택합니다.</p>
              </div>
              <div className="item-control">
                <select
                  value={settings.readingMode}
                  onChange={(e) => handleSettingChange("viewer_reading_mode", e.target.value, setReadingMode)}
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
                <label>읽기 방향</label>
                <p>페이지가 넘어가는 기본 방향을 설정합니다.</p>
              </div>
              <div className="item-control">
                <select
                  value={settings.readingDirection}
                  onChange={(e) => handleSettingChange("viewer_reading_direction", e.target.value, setReadingDirection)}
                  className="settings-select"
                >
                  <option value="ltr">왼쪽에서 오른쪽 (LTR)</option>
                  <option value="rtl">오른쪽에서 왼쪽 (RTL)</option>
                </select>
              </div>
            </div>

            <div className="settings-item">
              <div className="item-info">
                <label>이미지 맞춤</label>
                <p>뷰어에서 이미지를 화면에 맞추는 기본 방식을 설정합니다.</p>
              </div>
              <div className="item-control">
                <select
                  value={settings.fitMode}
                  onChange={(e) => handleSettingChange("viewer_fit_mode", e.target.value, setFitMode)}
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
