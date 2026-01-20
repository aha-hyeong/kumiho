import { useState, useEffect } from "react";
import { Monitor, Loader2, Cpu, RotateCcw } from "lucide-react";
import { AlertModal } from "../modals/AlertModal";
import { Toast } from "../common/Toast";
import { useViewerStore, type ReadingMode, type ReadingDirection, type FitMode } from "../../stores/viewerStore";
import { settingAPI } from "../../api/client";
import styles from "./SettingsComponents.module.css";
import localStyles from "./ViewerTab.module.css";

interface SettingsData {
  viewer_reading_mode?: string;
  viewer_reading_direction?: string;
  viewer_click_direction?: string;
  viewer_keyboard_direction?: string;
  viewer_fit_mode?: string;
  viewer_preload_count?: string;
  viewer_pull_threshold?: string;
  viewer_pull_sensitivity?: string;
  viewer_show_threshold?: string;
  [key: string]: string | undefined;
}

// 민감도 레벨 판별 함수
const getSensitivityLevel = (threshold: number, sensitivity: number): string => {
  if (threshold === 120 && sensitivity === 0.5) return "medium";
  if (threshold === 180 && sensitivity === 0.3) return "low";
  if (threshold === 80 && sensitivity === 0.8) return "high";
  return "custom"; // 그 외 사용자 정의 값인 경우
};

export function ViewerTab() {
  const {
    settings,
    setReadingMode,
    setReadingDirection,
    setClickDirection,
    setKeyboardDirection,
    setFitMode,
    setPreloadCount,
    setPullThreshold,
    setPullSensitivity,
    setShowThreshold,
  } = useViewerStore();
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);

  // 설정 가져오기
  useEffect(() => {
    let isMounted = true;
    const fetchSettings = async () => {
      try {
        const response = await settingAPI.list();
        if (!isMounted) return;

        const data = response as SettingsData;

        // 런타임 타입 검증 강화
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          throw new Error("Invalid response format: expected an object");
        }

        if (data.viewer_reading_mode) setReadingMode(data.viewer_reading_mode as ReadingMode);
        if (data.viewer_reading_direction) setReadingDirection(data.viewer_reading_direction as ReadingDirection);
        if (data.viewer_click_direction) setClickDirection(data.viewer_click_direction as ReadingDirection);
        if (data.viewer_keyboard_direction) setKeyboardDirection(data.viewer_keyboard_direction as ReadingDirection);
        if (data.viewer_fit_mode) setFitMode(data.viewer_fit_mode as FitMode);
        if (data.viewer_preload_count) setPreloadCount(parseInt(data.viewer_preload_count, 10));
        if (data.viewer_pull_threshold) setPullThreshold(parseInt(data.viewer_pull_threshold, 10));
        if (data.viewer_pull_sensitivity) setPullSensitivity(parseFloat(data.viewer_pull_sensitivity));
        if (data.viewer_show_threshold) setShowThreshold(parseInt(data.viewer_show_threshold, 10));
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
  }, [
    setReadingMode,
    setReadingDirection,
    setClickDirection,
    setKeyboardDirection,
    setFitMode,
    setPreloadCount,
    setPullThreshold,
    setPullSensitivity,
    setShowThreshold,
    setShowThreshold,
  ]);

  // 설정값에 따라 커스텀 모드 감지
  useEffect(() => {
    if (getSensitivityLevel(settings.pullThreshold, settings.pullSensitivity) === "custom") {
      setIsCustomMode(true);
    }
  }, [settings.pullThreshold, settings.pullSensitivity]);

  // 설정 업데이트 핸들러
  const handleSettingChange = async (key: string, value: string, updateFn: (val: string) => void) => {
    try {
      await settingAPI.update(key, { value });
      updateFn(value);
      setStatus({ type: "success", message: "설정이 저장되었습니다." });
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      setStatus({ type: "error", message: "설정 저장에 실패했습니다." });
    }
  };

  // 전체 뷰어 설정 초기화 실행
  const executeReset = async () => {
    try {
      // 로딩 상태를 표시하지 않고 진행 (UI 깜빡임 방지)

      // 1. API 업데이트 (병렬 처리로 속도 개선)
      await Promise.all([
        settingAPI.update("viewer_reading_mode", { value: "single" }),
        settingAPI.update("viewer_reading_direction", { value: "ltr" }),
        settingAPI.update("viewer_click_direction", { value: "ltr" }),
        settingAPI.update("viewer_keyboard_direction", { value: "ltr" }),
        settingAPI.update("viewer_fit_mode", { value: "screen" }),
        settingAPI.update("viewer_preload_count", { value: "6" }),
        settingAPI.update("viewer_pull_threshold", { value: "120" }),
        settingAPI.update("viewer_pull_sensitivity", { value: "0.5" }),
        settingAPI.update("viewer_show_threshold", { value: "10" }),
      ]);

      // 2. 스토어 상태 업데이트
      setReadingMode("single");
      setReadingDirection("ltr");
      setClickDirection("ltr");
      setKeyboardDirection("ltr");
      setFitMode("screen");
      setPreloadCount(6);
      setPullThreshold(120);
      setPullSensitivity(0.5);
      setShowThreshold(10);

      setStatus({ type: "success", message: "모든 뷰어 설정이 초기화되었습니다." });
      setIsResetModalOpen(false); // 모달 닫기
    } catch (error) {
      console.error("Failed to reset settings:", error);
      setStatus({ type: "error", message: "설정 초기화에 실패했습니다." });
      setIsResetModalOpen(false);
    }
  };

  // 초기화 버튼 핸들러
  const handleResetClick = () => {
    setIsResetModalOpen(true);
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
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}
      <div className={styles.tabHeader}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2>뷰어 설정</h2>
            <p className={styles.tabDescription}>뷰어 동작 및 화면 표시 방법을 설정합니다.</p>
          </div>
          <button
            onClick={handleResetClick}
            className={localStyles.resetButton}
            title="모든 설정 초기화"
          >
            <RotateCcw size={14} />
            <span>초기화</span>
          </button>
        </div>
      </div>

      <div className={styles.settingsSections}>
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

        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Cpu size={18} />
            <h3>고급 설정</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_preload_count">이미지 프리로드 개수</label>
                <p>미리 불러올 이미지 개수를 설정합니다. (1-20)</p>
              </div>
              <div className={styles.itemControl}>
                <input
                  type="number"
                  id="viewer_preload_count"
                  min="1"
                  max="20"
                  value={settings.preloadCount}
                  onChange={(e) => {
                    const { value } = e.target;
                    const val = parseInt(value, 10);

                    // 유효성 검사: 빈 값이거나 1~20 범위를 벗어난 경우 에러 표시
                    if (value === "" || isNaN(val) || val < 1 || val > 20) {
                      e.target.setCustomValidity("1에서 20 사이의 값을 입력해주세요.");
                      e.target.reportValidity();
                      return;
                    }

                    // 유효한 값인 경우 에러 상태 제거 후 설정 반영
                    e.target.setCustomValidity("");
                    handleSettingChange("viewer_preload_count", value, (v) => setPreloadCount(parseInt(v, 10)));
                  }}
                  className={styles.settingsInput}
                  style={{ width: "80px" }}
                />
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_sensitivity">스크롤 당김 민감도</label>
                <p>세로 모드에서 페이지 이동을 위한 스크롤 감도를 설정합니다.</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_sensitivity"
                  value={
                    isCustomMode ? "custom" : getSensitivityLevel(settings.pullThreshold, settings.pullSensitivity)
                  }
                  onChange={(e) => {
                    const level = e.target.value;
                    if (level === "custom") {
                      setIsCustomMode(true);
                      return;
                    }

                    setIsCustomMode(false);
                    let threshold = 120;
                    let sensitivity = 0.5;

                    switch (level) {
                      case "low":
                        threshold = 180;
                        sensitivity = 0.3;
                        break;
                      case "high":
                        threshold = 80;
                        sensitivity = 0.8;
                        break;
                      case "medium":
                      default:
                        threshold = 120;
                        sensitivity = 0.5;
                        break;
                    }

                    // 두 값을 동시에 업데이트 (Promise.all로 원자성 확보 시도)
                    Promise.all([
                      settingAPI.update("viewer_pull_threshold", { value: threshold.toString() }),
                      settingAPI.update("viewer_pull_sensitivity", { value: sensitivity.toString() }),
                    ])
                      .then(() => {
                        setPullThreshold(threshold);
                        setPullSensitivity(sensitivity);
                        setStatus({ type: "success", message: "설정이 저장되었습니다." });
                      })
                      .catch((error) => {
                        console.error("Failed to update sensitivity settings:", error);
                        setStatus({ type: "error", message: "설정 저장에 실패했습니다." });
                      });
                  }}
                  className={styles.settingsSelect}
                >
                  <option value="low">둔감 (실수가 적음)</option>
                  <option value="medium">보통 (기본값)</option>
                  <option value="high">민감 (빠른 이동)</option>
                  <option value="custom">사용자 정의</option>
                </select>

                {isCustomMode && (
                  <div
                    style={{
                      marginTop: "1rem",
                      padding: "1rem",
                      background: "rgba(255, 255, 255, 0.05)",
                      borderRadius: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "1.2rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                        <label
                          htmlFor="custom_threshold"
                          style={{ fontSize: "0.9rem", color: "#e2e8f0" }}
                        >
                          당김 거리 (px)
                        </label>
                        <p style={{ fontSize: "0.75rem", color: "#718096", margin: 0 }}>
                          페이지 이동을 위해 당겨야 하는 최소 거리입니다. <br />
                          값이 클수록 실수로 페이지가 넘어가는 것을 방지합니다.
                        </p>
                      </div>
                      <input
                        type="number"
                        id="custom_threshold"
                        value={settings.pullThreshold}
                        onChange={(e) =>
                          handleSettingChange("viewer_pull_threshold", e.target.value, (v) =>
                            setPullThreshold(parseInt(v, 10)),
                          )
                        }
                        className={styles.settingsInput}
                        style={{ width: "100px" }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                        <label
                          htmlFor="custom_sensitivity"
                          style={{ fontSize: "0.9rem", color: "#e2e8f0" }}
                        >
                          저항 계수 (0 ~ 1)
                        </label>
                        <p style={{ fontSize: "0.75rem", color: "#718096", margin: 0 }}>
                          스크롤 당김에 반응하는 민감도입니다. <br />
                          값이 1에 가까울수록 손가락 움직임에 즉각 반응합니다.
                        </p>
                      </div>
                      <input
                        type="number"
                        id="custom_sensitivity"
                        step="0.1"
                        min="0"
                        max="1"
                        value={settings.pullSensitivity}
                        onChange={(e) =>
                          handleSettingChange("viewer_pull_sensitivity", e.target.value, (v) =>
                            setPullSensitivity(parseFloat(v)),
                          )
                        }
                        className={styles.settingsInput}
                        style={{ width: "100px" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
      <AlertModal
        isOpen={isResetModalOpen}
        type="warning"
        title="뷰어 설정 초기화"
        message="모든 뷰어 설정(보기 모드, 방향, 고급 설정 등)이 기본값으로 초기화됩니다. 계속하시겠습니까?"
        confirmText="초기화"
        cancelText="취소"
        showCancel={true}
        onConfirm={executeReset}
        onCancel={() => setIsResetModalOpen(false)}
      />
    </div>
  );
}
