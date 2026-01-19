import { useState, useEffect, useCallback } from "react";
import { Trash2, Plus, RefreshCw, FolderOpen, Settings, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { libraryAPI } from "../../api/client";
import { useLibraryStore, type Library } from "../../stores/libraryStore";
import { Toast } from "../common/Toast";
import { AlertModal } from "../modals/AlertModal";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./LibrariesTab.module.css";

interface SortableItemProps {
  lib: Library;
  onEdit: (lib: Library) => void;
  onScan: (id: string) => void;
  onDelete: (lib: Library) => void;
  editingLibrary: Library | null;
  setEditingLibrary: (lib: Library | null) => void;
  handleUpdateLibrary: (id: string, data: Partial<Library>) => void;
}

function SortableLibraryItem({
  lib,
  onEdit,
  onScan,
  onDelete,
  editingLibrary,
  setEditingLibrary,
  handleUpdateLibrary,
}: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lib.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.libraryItemContainer}
    >
      <div className={`${commonStyles.settingsItem} ${styles.libraryItem}`}>
        <div className={styles.libraryInfoGroup}>
          <div
            className={styles.dragHandle}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={20} />
          </div>
          <div className={commonStyles.itemInfo}>
            <label className={styles.libraryName}>{lib.name}</label>
            <p className={styles.libraryPath}>{lib.path}</p>
            <div className={styles.libraryMeta}>
              <span>
                {lib.default_view_mode === "single"
                  ? "한 페이지"
                  : lib.default_view_mode === "double"
                    ? "두 페이지"
                    : "세로 스크롤"}
              </span>
              <span>•</span>
              <span>{lib.default_read_direction === "ltr" ? "왼쪽에서 오른쪽" : "오른쪽에서 왼쪽"}</span>
            </div>
          </div>
        </div>
        <div className={`${commonStyles.itemControl} ${styles.actionButtons}`}>
          <button
            onClick={() => onEdit(lib)}
            className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
            style={{
              color: "#63b3ed",
              borderColor: "rgba(99, 179, 237, 0.3)",
            }}
            title="설정 수정"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={() => onScan(lib.id)}
            disabled={lib.scan_status === "SCANNING"}
            className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
            style={{
              color: lib.scan_status === "SCANNING" ? "#a0aec0" : "#68d391",
              borderColor: lib.scan_status === "SCANNING" ? "rgba(160, 174, 192, 0.3)" : "rgba(104, 211, 145, 0.3)",
              cursor: lib.scan_status === "SCANNING" ? "not-allowed" : "pointer",
            }}
            title={lib.scan_status === "SCANNING" ? "스캔 중..." : "지금 스캔"}
          >
            <RefreshCw
              size={16}
              className={lib.scan_status === "SCANNING" ? styles.spin : ""}
            />
          </button>
          <button
            onClick={() => onDelete(lib)}
            className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
            style={{
              color: "#fc8181",
              borderColor: "rgba(252, 129, 129, 0.3)",
            }}
            title="삭제"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {editingLibrary?.id === lib.id && (
        <div className={styles.editForm}>
          <div className={styles.editGrid}>
            <div className={styles.flexOne}>
              <label className={styles.fieldLabel}>라이브러리 이름</label>
              <input
                type="text"
                value={editingLibrary.name}
                onChange={(e) => setEditingLibrary({ ...editingLibrary, name: e.target.value })}
                className={commonStyles.settingsInput}
              />
            </div>
            <div className={styles.flexOne}>
              <label className={styles.fieldLabel}>보기 모드</label>
              <select
                value={editingLibrary.default_view_mode}
                onChange={(e) => setEditingLibrary({ ...editingLibrary, default_view_mode: e.target.value })}
                className={commonStyles.settingsSelect}
              >
                <option value="single">한 페이지</option>
                <option value="double">두 페이지</option>
                <option value="vertical">세로 스크롤</option>
              </select>
            </div>
            <div className={styles.flexOne}>
              <label className={styles.fieldLabel}>읽기 방향</label>
              <select
                value={editingLibrary.default_read_direction}
                onChange={(e) => setEditingLibrary({ ...editingLibrary, default_read_direction: e.target.value })}
                className={commonStyles.settingsSelect}
              >
                <option value="ltr">왼쪽에서 오른쪽</option>
                <option value="rtl">오른쪽에서 왼쪽</option>
              </select>
            </div>
            <div className={styles.editActions}>
              <button
                onClick={() => handleUpdateLibrary(lib.id, editingLibrary)}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "#4a5568" }}
              >
                저장
              </button>
              <button
                onClick={() => setEditingLibrary(null)}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "transparent" }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LibrariesTab() {
  const { libraries, isLoading, fetchLibraries: storeFetchLibraries, setLibraries } = useLibraryStore();
  const [isCreating, setIsCreating] = useState(false);
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [libraryToDelete, setLibraryToDelete] = useState<Library | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // New library form state
  const [newLibrary, setNewLibrary] = useState({
    name: "",
    path: "",
    default_view_mode: "single",
    default_read_direction: "ltr",
  });

  const fetchLibraries = useCallback(async () => {
    await storeFetchLibraries();
  }, [storeFetchLibraries]);

  useEffect(() => {
    fetchLibraries();
  }, [fetchLibraries]);

  // Polling for scan status
  useEffect(() => {
    const hasScanningLibrary = libraries.some((l) => l.scan_status === "SCANNING");
    if (!hasScanningLibrary) return;

    const interval = setInterval(() => {
      fetchLibraries();
    }, 3000);

    return () => clearInterval(interval);
  }, [libraries, fetchLibraries]);

  const handleCreateLibrary = async () => {
    if (!newLibrary.name || !newLibrary.path) {
      setStatus({ type: "error", message: "이름과 경로를 입력해주세요." });
      return;
    }

    try {
      await libraryAPI.create(newLibrary);
      setStatus({ type: "success", message: "라이브러리가 생성되었습니다." });
      setIsCreating(false);
      setNewLibrary({ name: "", path: "", default_view_mode: "single", default_read_direction: "ltr" });
      fetchLibraries();
    } catch (error: any) {
      console.error("Failed to create library:", error);
      setStatus({ type: "error", message: error.response?.data?.error || "라이브러리 생성에 실패했습니다." });
    }
  };

  const handleUpdateLibrary = async (id: string, data: Partial<Library>) => {
    try {
      await libraryAPI.update(id, data);
      setStatus({ type: "success", message: "라이브러리가 수정되었습니다." });
      setEditingLibrary(null);
      fetchLibraries();
    } catch (error: any) {
      console.error("Failed to update library:", error);
      setStatus({ type: "error", message: error.response?.data?.error || "라이브러리 수정에 실패했습니다." });
    }
  };

  const handleDeleteLibrary = (lib: Library) => {
    setLibraryToDelete(lib);
    setIsDeleteModalOpen(true);
  };

  const executeDelete = async () => {
    if (!libraryToDelete) return;

    try {
      await libraryAPI.delete(libraryToDelete.id);
      setStatus({ type: "success", message: "라이브러리가 삭제되었습니다." });
      setIsDeleteModalOpen(false);
      setLibraryToDelete(null);
      fetchLibraries();
    } catch (error) {
      console.error("Failed to delete library:", error);
      setStatus({ type: "error", message: "라이브러리 삭제에 실패했습니다." });
      setIsDeleteModalOpen(false);
    }
  };

  const handleScanLibrary = async (id: string) => {
    try {
      setStatus({ type: "success", message: "스캔이 시작되었습니다." }); // Optimistic UI
      await libraryAPI.scan(id);
      setStatus({ type: "success", message: "스캔이 완료되었습니다." });
    } catch (error) {
      console.error("Failed to scan library:", error);
      setStatus({ type: "error", message: "스캔 요청에 실패했습니다." });
    }
  };

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = libraries.findIndex((lib) => lib.id === active.id);
        const newIndex = libraries.findIndex((lib) => lib.id === over.id);

        const newLibraries = arrayMove(libraries, oldIndex, newIndex);
        setLibraries(newLibraries);

        try {
          await libraryAPI.updateOrder(newLibraries.map((l) => l.id));
          // Optional: setStatus({ type: "success", message: "순서가 저장되었습니다." });
        } catch (error) {
          console.error("Failed to update library order:", error);
          setStatus({ type: "error", message: "순서 저장에 실패했습니다." });
          fetchLibraries(); // Rollback
        }
      }
    },
    [libraries, setLibraries, fetchLibraries],
  );

  return (
    <div className={`${styles.tabContent} ${styles.relative}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}

      <div className={commonStyles.tabHeader}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            className={styles.dragHandle}
            style={{ visibility: "hidden" }}
            aria-hidden="true"
          >
            <GripVertical size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h2>라이브러리 관리</h2>
            <p className={commonStyles.tabDescription}>미디어 파일이 위치한 폴더를 관리합니다.</p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className={commonStyles.settingsSelect}
              style={{ width: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Plus size={16} />
              라이브러리 추가
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <div className={`${commonStyles.settingsSection} ${styles.createForm}`}>
          <div className={commonStyles.sectionTitle}>
            <FolderOpen size={18} />
            <h3>새 라이브러리 추가</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>경로 설정</label>
                <p>서버 내의 실제 폴더 경로를 입력하세요.</p>
              </div>
              <div className={`${commonStyles.itemControl} ${styles.inputGroup}`}>
                <input
                  type="text"
                  placeholder="라이브러리 이름 (예: 만화책)"
                  value={newLibrary.name}
                  onChange={(e) => setNewLibrary({ ...newLibrary, name: e.target.value })}
                  className={commonStyles.settingsInput}
                />
                <input
                  type="text"
                  placeholder="폴더 경로 (예: /data/comics)"
                  value={newLibrary.path}
                  onChange={(e) => setNewLibrary({ ...newLibrary, path: e.target.value })}
                  className={commonStyles.settingsInput}
                />
              </div>
            </div>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>기본 뷰어 설정</label>
                <p>이 라이브러리의 기본 보기 방식을 설정합니다.</p>
              </div>
              <div className={`${commonStyles.itemControl} ${styles.selectGroup}`}>
                <select
                  value={newLibrary.default_view_mode}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_view_mode: e.target.value })}
                  className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                >
                  <option value="single">한 페이지</option>
                  <option value="double">두 페이지</option>
                  <option value="vertical">세로 스크롤</option>
                </select>
                <select
                  value={newLibrary.default_read_direction}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_read_direction: e.target.value })}
                  className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                >
                  <option value="ltr">왼쪽에서 오른쪽</option>
                  <option value="rtl">오른쪽에서 왼쪽</option>
                </select>
              </div>
            </div>
            <div className={styles.formActions}>
              <button
                onClick={() => setIsCreating(false)}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                취소
              </button>
              <button
                onClick={handleCreateLibrary}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "#4a5568" }}
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className={commonStyles.placeholderContent}>Loading...</div>
      ) : (
        <div className={styles.libraryList}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={libraries.map((l) => l.id)}
              strategy={verticalListSortingStrategy}
            >
              {libraries.map((lib: Library) => (
                <SortableLibraryItem
                  key={lib.id}
                  lib={lib}
                  editingLibrary={editingLibrary}
                  setEditingLibrary={setEditingLibrary}
                  handleUpdateLibrary={handleUpdateLibrary}
                  onEdit={(l) => setEditingLibrary(editingLibrary?.id === l.id ? null : l)}
                  onScan={handleScanLibrary}
                  onDelete={handleDeleteLibrary}
                />
              ))}
            </SortableContext>
          </DndContext>
          {libraries.length === 0 && <div className={commonStyles.placeholderContent}>라이브러리가 없습니다.</div>}
        </div>
      )}
      <AlertModal
        isOpen={isDeleteModalOpen}
        type="warning"
        title="라이브러리 삭제"
        message={`정말로 '${libraryToDelete?.name}' 라이브러리를 삭제하시겠습니까? 메타데이터만 삭제되며 실제 파일은 유지됩니다.`}
        confirmText="삭제"
        cancelText="취소"
        showCancel={true}
        onConfirm={executeDelete}
        onCancel={() => {
          setIsDeleteModalOpen(false);
          setLibraryToDelete(null);
        }}
      />
    </div>
  );
}
