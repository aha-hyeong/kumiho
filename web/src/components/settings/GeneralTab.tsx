import { useState, useEffect } from "react";
import { Languages, Loader2, Layout, GripVertical, Eye, EyeOff, Music } from "lucide-react";
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

interface SectionItem {
  id: string;
  title: string;
  description: string;
}

const SECTIONS: Record<string, SectionItem> = {
  continue: {
    id: "continue",
    title: "계속 읽기",
    description: "최근 읽던 책들을 이어서 봅니다.",
  },
  liked: {
    id: "liked",
    title: "좋아요한 시리즈",
    description: "좋아요(즐겨찾기) 표시한 시리즈를 모아봅니다.",
  },
  updated: {
    id: "updated",
    title: "업데이트된 시리즈",
    description: "새로 추가된 시리즈나 챕터를 확인합니다.",
  },
};

interface SortableSectionItemProps {
  id: string;
  isVisible?: boolean;
  onToggle?: () => void;
}

function SortableSectionItem({ id, isVisible, onToggle }: SortableSectionItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  const item = SECTIONS[id];
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
          <div className={styles.sectionTitle}>{item.title}</div>
          <div className={styles.sectionDescription}>{item.description}</div>
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
            title={isVisible !== false ? "숨기기" : "보이기"}
          >
            {isVisible !== false ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
      )}
    </div>
  );
}

export function GeneralTab() {
  const [language, setLanguage] = useState("ko");
  const [homeLayoutOrder, setHomeLayoutOrder] = useState("");
  const [sectionOrder, setSectionOrder] = useState<string[]>(["continue", "liked", "updated"]);
  const [bgmEnabled, setBgmEnabled] = useState("true");
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
      setStatus({ type: "error", message: "변경 실패" });
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

        if (typeof data.app_language === "string") setLanguage(data.app_language);
        if (typeof data.home_layout_order === "string") {
          setHomeLayoutOrder(data.home_layout_order);
          // Update section list based on setting
          if (data.home_layout_order === "swapped") {
            setSectionOrder(["updated", "continue", "liked"]);
          } else if (data.home_layout_order === "default") {
            setSectionOrder(["continue", "liked", "updated"]);
          } else {
            // 쉼표로 구분된 섹션 ID 목록 (예: "continue,liked,updated")
            const order = data.home_layout_order.split(",").filter((id) => SECTIONS[id]);
            if (order.length > 0) {
              // 누락된 섹션 추가 (migration)
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

        // 라이브러리 정보 로드 (visibility 확인용)
        fetchLibraries();
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
  }, []);

  // 설정 업데이트 핸들러
  const handleSettingChange = async (key: string, value: string, updateFn?: (val: string) => void) => {
    try {
      await settingAPI.update(key, { value });

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
          <p>설정을 불러오는 중...</p>
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
        <h2>일반 설정</h2>
        <p className={commonStyles.tabDescription}>애플리케이션 언어 및 홈 화면 기본 설정을 관리합니다.</p>
      </div>

      <div className={commonStyles.settingsSections}>
        {/* 언어 설정 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <Languages size={18} />
            <h3>언어 설정</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="app_language">기본 언어</label>
                <p>애플리케이션에 표시될 언어를 선택하세요.</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  id="app_language"
                  value={language}
                  onChange={(e) => handleSettingChange("app_language", e.target.value)}
                  className={commonStyles.settingsSelect}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* 홈 화면 설정 */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <Layout size={18} />
            <h3>홈 화면 설정</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div
              className={commonStyles.settingsItem}
              style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}
            >
              <div className={commonStyles.itemInfo}>
                <label>섹션 순서</label>
                <p>드래그하여 홈 화면의 섹션 표시 순서를 변경하세요.</p>
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
            <h3>배경음악 설정</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label htmlFor="bgm_enabled">배경음악 자동 재생</label>
                <p>뷰어에서 배경음악 파일이 있는 경우 자동으로 재생합니다.</p>
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
                  <option value="true">켜기</option>
                  <option value="false">끄기</option>
                </select>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
