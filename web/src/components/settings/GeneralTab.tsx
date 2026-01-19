import { useState, useEffect } from "react";
import { Languages, Loader2, Layout, GripVertical } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { settingsAPI } from "../../api/client";
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
  updated: {
    id: "updated",
    title: "업데이트된 시리즈",
    description: "새로 추가된 시리즈나 챕터를 확인합니다.",
  },
};

function SortableSectionItem({ id }: { id: string }) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.sectionItem}
    >
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
  );
}

export function GeneralTab() {
  const [language, setLanguage] = useState("ko");
  const [homeLayoutOrder, setHomeLayoutOrder] = useState("default");
  const [sectionOrder, setSectionOrder] = useState<string[]>(["continue", "updated"]);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

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
        if (typeof data.home_layout_order === "string") {
          setHomeLayoutOrder(data.home_layout_order);
          // Update section list based on setting
          if (data.home_layout_order === "swapped") {
            setSectionOrder(["updated", "continue"]);
          } else {
            setSectionOrder(["continue", "updated"]);
          }
        }
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
        // ["updated", "continue"] -> "swapped"
        // ["continue", "updated"] -> "default"
        const newSettingValue = newOrder[0] === "updated" ? "swapped" : "default";

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
