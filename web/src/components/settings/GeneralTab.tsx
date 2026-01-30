import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Languages, Loader2, Layout, GripVertical, Eye, EyeOff, Music, ArrowLeftRight } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { settingAPI, libraryAPI } from "../../api/client";
import { useLibraryStore } from "../../stores/libraryStore";
import { Toast } from "../common/Toast";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./GeneralTab.module.css";

interface SettingsData {
  app_language?: string;
  home_layout_order?: string;
  [key: string]: string | undefined;
}

const SECTIONS = {
  continue: {
    id: "continue",
    titleKey: "home.sections.continue_reading.title",
    descKey: "home.sections.continue_reading.desc",
  },
  liked: {
    id: "liked",
    titleKey: "home.sections.liked.title",
    descKey: "home.sections.liked.desc",
  },
  updated: {
    id: "updated",
    titleKey: "home.sections.updated.title",
    descKey: "home.sections.updated.desc",
  },
};

interface SortableSectionItemProps {
  id: string;
  isVisible?: boolean;
  onToggle?: () => void;
}

function SortableSectionItem({ id, isVisible, onToggle }: SortableSectionItemProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  const item = SECTIONS[id as keyof typeof SECTIONS];
  // item이 없으면 렌더링하지 않음 (방어 코드)
  if (!item) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.sectionItem}
    >
      <div className={styles.sectionInfoGroup}>
        <div
          className={styles.dragHandle}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={20} />
        </div>
        <div className={styles.sectionInfo}>
          <div className={styles.sectionTitle}>{t(item.titleKey)}</div>
          <div className={styles.sectionDescription}>{t(item.descKey)}</div>
        </div>
      </div>
      {onToggle && (
        <div className={styles.actionButtons}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
            style={{
              color: isVisible !== false ? "#63b3ed" : "#a0aec0",
              borderColor: isVisible !== false ? "rgba(99, 179, 237, 0.3)" : "rgba(160, 174, 192, 0.3)",
            }}
            title={isVisible !== false ? t("common.hide") : t("common.show")}
          >
            {isVisible !== false ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
      )}
    </div>
  );
}

export function GeneralTab() {
  const { t, i18n } = useTranslation();
  const [language, setLanguage] = useState("ko");
  const [homeLayoutOrder, setHomeLayoutOrder] = useState("");
  const [sectionOrder, setSectionOrder] = useState<string[]>(["continue", "liked", "updated"]);
  const [bgmEnabled, setBgmEnabled] = useState("true");
  const [swipeDirection, setSwipeDirection] = useState("ltr");
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { libraries, fetchLibraries } = useLibraryStore();
  // SYSTEM 라이브러리를 '좋아요한 시리즈' 섹션과 연동
  const systemLibrary = libraries.find((l) => l.type === "SYSTEM");

  const toggleLikedVisibility = async () => {
    if (!systemLibrary) return;

    // 낙관적 업데이트를 위한 이전 상태 저장
    const newVisibility = !(systemLibrary.is_visible !== false);

    try {
      // 1. Store 업데이트 (Optimistic UI)
      // useLibraryStore의 상태를 직접 수정하는 action이 있다면 좋겠지만,
      // 여기서는 fetchLibraries()를 다시 부르기 전까지 UI 반응성을 위해 로컬 state처럼 보이게 하거나,
      // store에 updateLibraryOptimistic 같은게 없다면 fetchLibraries에 의존해야 함.
      // 하지만 사용자 경험을 위해 일단 API 요청을 보냄.
      // LibrariesTab에서는 setLibraries를 통해 낙관적 업데이트를 하고 있음.
      // 여기서는 store의 전역 상태를 건드리기 어려우므로 API 요청 후 fetchLibraries 호출.
      // 다만 UX를 위해 status 메시지는 성공 시에만 띄우거나 생략.

      await libraryAPI.update(systemLibrary.id, { is_visible: newVisibility });
      fetchLibraries();
    } catch (e) {
      console.error("Failed to toggle visibility", e);
      setStatus({ type: "error", message: t("settings.general.toast.update_failed") });
      // 실패 시 롤백은 fetchLibraries()가 기존 상태를 불러오므로 자동 처리됨
    }
  };

  const sensors = useSensors(useSensor(PointerSensor));

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

        if (typeof data.app_language === "string") {
          setLanguage(data.app_language);
          i18n.changeLanguage(data.app_language);
        }
        if (typeof data.home_layout_order === "string") {
          setHomeLayoutOrder(data.home_layout_order);
          // Update section list based on setting
          if (data.home_layout_order === "swapped") {
            setSectionOrder(["updated", "continue", "liked"]);
          } else if (data.home_layout_order === "default") {
            setSectionOrder(["continue", "liked", "updated"]);
          } else {
            // 쉼표로 구분된 섹션 ID 목록 (예: "continue,liked,updated")
            const order = data.home_layout_order
              .split(",")
              .filter((id) => Object.prototype.hasOwnProperty.call(SECTIONS, id));
            if (order.length > 0) {
              const allKeys = Object.keys(SECTIONS);
              const missing = allKeys.filter((k) => !order.includes(k));
              setSectionOrder([...order, ...missing]);
            } else {
              setSectionOrder(["continue", "liked", "updated"]);
            }
          }
        }

        if (typeof data.bgm_enabled === "string") setBgmEnabled(data.bgm_enabled);
        else setBgmEnabled("true"); // 기본값 켜기

        if (typeof data.swipe_direction === "string") setSwipeDirection(data.swipe_direction);
        else setSwipeDirection("ltr"); // 기본값 LTR

        // 라이브러리 정보 로드 (visibility 확인용)
        fetchLibraries();
      } catch (error) {
        if (isMounted) {
          console.error("Failed to fetch settings:", error);
          setStatus({ type: "error", message: t("settings.general.toast.load_failed") });
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchSettings();
    return () => {
      isMounted = false;
    };
  }, [fetchLibraries]);

  // 설정 업데이트 핸들러
  const handleSettingChange = async (key: string, value: string, updateFn?: (val: string) => void) => {
    try {
      await settingAPI.update(key, { value });

      if (updateFn) {
        updateFn(value);
      } else if (key === "app_language") {
        setLanguage(value);
        i18n.changeLanguage(value);
      }
      setStatus({ type: "success", message: t("settings.general.toast.save_success") });
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      setStatus({ type: "error", message: t("settings.general.toast.save_failed") });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSectionOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);

        // Determine setting value based on new order
        const newSettingValue = newOrder.join(",");

        if (newSettingValue !== homeLayoutOrder) {
          setHomeLayoutOrder(newSettingValue);
          handleSettingChange("home_layout_order", newSettingValue);
        }

        return newOrder;
      });
    }
  };

  if (isLoading) {
    return (
      <div className={commonStyles.tabContent}>
        <div className={commonStyles.placeholderContent}>
          <Loader2
            className={commonStyles.loadingSpinner}
            size={24}
          />
          <p>{t("common.loading_settings")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${commonStyles.tabContent} ${commonStyles.relative}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}
      <div className={commonStyles.tabHeader}>
        <h2>{t("settings.general.title")}</h2>
        <p className={commonStyles.tabDescription}>{t("settings.general.desc")}</p>
      </div>

      <div className={commonStyles.settingsSections}>
        {/* 언어 설정 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <Languages size={18} />
            <h3>{t("settings.general.language.title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="app_language">{t("settings.general.language.label")}</label>
                <p>{t("settings.general.language.desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  id="app_language"
                  value={language}
                  onChange={(e) => handleSettingChange("app_language", e.target.value)}
                  className={commonStyles.settingsSelect}
                >
                  <option value="ko">{t("settings.general.language.ko")}</option>
                  <option value="en">{t("settings.general.language.en")}</option>
                  <option value="ja">{t("settings.general.language.ja")}</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* 홈 화면 설정 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <Layout size={18} />
            <h3>{t("settings.general.home_layout.title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div
              className={commonStyles.settingsItem}
              style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}
            >
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.general.home_layout.label")}</label>
                <p>{t("settings.general.home_layout.desc")}</p>
              </div>

              <div className={styles.sectionList}>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={sectionOrder}
                    strategy={verticalListSortingStrategy}
                  >
                    {sectionOrder.map((id) => (
                      <SortableSectionItem
                        key={id}
                        id={id}
                        isVisible={id === "liked" ? systemLibrary?.is_visible !== false : undefined}
                        onToggle={id === "liked" ? toggleLikedVisibility : undefined}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          </div>
        </section>
        {/* 배경음악 설정 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <Music size={18} />
            <h3>{t("settings.general.bgm.title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="bgm_enabled">{t("settings.general.bgm.label")}</label>
                <p>{t("settings.general.bgm.desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  id="bgm_enabled"
                  value={bgmEnabled}
                  onChange={(e) => {
                    setBgmEnabled(e.target.value);
                    handleSettingChange("bgm_enabled", e.target.value);
                  }}
                  className={commonStyles.settingsSelect}
                >
                  <option value="true">{t("common.on")}</option>
                  <option value="false">{t("common.off")}</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* 스와이프 방향 설정 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <ArrowLeftRight size={18} />
            <h3>{t("settings.general.swipe.title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="swipe_direction">{t("settings.general.swipe.label")}</label>
                <p>{t("settings.general.swipe.desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  id="swipe_direction"
                  value={swipeDirection}
                  onChange={(e) => {
                    setSwipeDirection(e.target.value);
                    handleSettingChange("swipe_direction", e.target.value);
                  }}
                  className={commonStyles.settingsSelect}
                >
                  <option value="ltr">{t("settings.general.swipe.ltr")}</option>
                  <option value="rtl">{t("settings.general.swipe.rtl")}</option>
                </select>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
