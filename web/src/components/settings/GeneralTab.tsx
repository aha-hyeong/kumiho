import { useState, useEffect } from "react";
import { Languages, Loader2, Layout, GripVertical, Eye, EyeOff } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { settingsAPI, libraryAPI } from "../../api/client";
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
            className={commonStyles.settingsSelect}
            style={{
              width: "auto",
              padding: "0.5rem",
              background: "transparent",
              color: isVisible !== false ? "#63b3ed" : "#a0aec0",
              borderColor: isVisible !== false ? "rgba(99, 179, 237, 0.3)" : "rgba(160, 174, 192, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
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
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { libraries, fetchLibraries } = useLibraryStore();
  // 실제 ID 확인 필요하지만 일단 type으로 찾을 수도 있음.
  // 백엔드에서 생성시 id='system-likes'로 지정했는지?
  // 마이그레이션 코드(Step 249 view)에 의하면 ID='system-likes' 일 것임?
  // 확인되지 않았으면 id가 아니라 type='SYSTEM'으로 찾아야 함.
  // 하지만 type='SYSTEM'은 여러 개일 수도? 현재는 "Liked Series" 하나뿐.
  // 안전하게 type='SYSTEM' && name='Liked Series' 또는 이와 유사한 조건 사용 필요.
  // 여기서는 단순히 libraries.find(l => l.type === 'SYSTEM') 사용.

  const systemLibrary = libraries.find((l) => l.type === "SYSTEM");

  const toggleLikedVisibility = async () => {
    if (!systemLibrary) return;
    try {
      const newVisibility = systemLibrary.is_visible === false; // false면 true로, undefined/true면 false로?
      // is_visible default is true (undefined -> true). So if currently false, make true. If true/undefined, make false.
      // But explicit check: is_visible !== false -> true.

      await libraryAPI.update(systemLibrary.id, { is_visible: !newVisibility ? false : true });
      fetchLibraries(); // Refresh store
    } catch (e) {
      console.error("Failed to toggle visibility", e);
      setStatus({ type: "error", message: "변경 실패" });
    }
  };

  const sensors = useSensors(useSensor(PointerSensor));

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
        if (typeof data.app_language === "string") setLanguage(data.app_language);
        if (typeof data.home_layout_order === "string") {
          setHomeLayoutOrder(data.home_layout_order);
          // Update section list based on setting
          if (data.home_layout_order === "swapped") {
            setSectionOrder(["updated", "continue", "liked"]);
          } else if (data.home_layout_order === "default") {
            setSectionOrder(["continue", "liked", "updated"]);
          } else {
            // CSV format
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
      </div>
    </div>
  );
}
