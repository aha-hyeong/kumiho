import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Trash2,
  Plus,
  RefreshCw,
  FolderOpen,
  Settings,
  GripVertical,
  Eye,
  EyeOff,
  Clock,
  Folder,
  Square,
} from "lucide-react";
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
import { useScanStore } from "../../stores/scanStore";
import { Toast } from "../common/Toast";
import { AlertModal } from "../modals/AlertModal";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./LibrariesTab.module.css";
import { settingAPI } from "../../api/client";
import { useAuthStore } from "../../stores/authStore";

interface SortableItemProps {
  lib: Library;
  onEdit: (lib: Library) => void;
  onScan: (id: string) => void;
  onDelete: (lib: Library) => void;
  onToggleVisibility: (lib: Library) => void;
  editingLibrary: Library | null;
  setEditingLibrary: (lib: Library | null) => void;
  handleUpdateLibrary: (id: string, data: Partial<Library>) => void;
}

function SortableLibraryItem({
  lib,
  onEdit,
  onScan,
  onDelete,
  onToggleVisibility,
  editingLibrary,
  setEditingLibrary,
  handleUpdateLibrary,
}: SortableItemProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lib.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging || lib.is_visible === false ? 0.5 : 1,
  };

  const isSystem = lib.type === "SYSTEM";

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
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label className={styles.libraryName}>
                {isSystem && lib.name === "좋아요한 시리즈" ? t("sidebar.system.liked") : lib.name}
              </label>
              {isSystem && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    background: "#4299e1",
                    color: "white",
                    padding: "0.1rem 0.4rem",
                    borderRadius: "4px",
                  }}
                >
                  {t("settings.libraries.item.system_badge")}
                </span>
              )}
            </div>
            <p className={styles.libraryPath}>{lib.path}</p>
            <div className={styles.libraryMeta}>
              {!isSystem && (
                <>
                  <span>
                    {lib.default_view_mode === "single"
                      ? t("settings.viewer.mode.single")
                      : lib.default_view_mode === "double"
                        ? t("settings.viewer.mode.double")
                        : t("settings.viewer.mode.vertical")}
                  </span>
                  <span>•</span>
                  <span>
                    {lib.default_read_direction === "ltr"
                      ? t("settings.viewer.direction.ltr")
                      : t("settings.viewer.direction.rtl")}
                  </span>
                  <span>•</span>
                  <span>
                    {lib.default_page_transition === "slide"
                      ? t("viewer.settings.page_transition.slide")
                      : lib.default_page_transition === "fade"
                        ? t("viewer.settings.page_transition.fade")
                        : t("viewer.settings.page_transition.none")}
                  </span>
                </>
              )}
              {isSystem && <span>{t("settings.libraries.item.system_notice")}</span>}
            </div>
          </div>
        </div>
        <div className={`${commonStyles.itemControl} ${styles.actionButtons}`}>
          {isSystem ? (
            <button
              onClick={() => onToggleVisibility(lib)}
              className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
              style={{
                color: lib.is_visible !== false ? "#63b3ed" : "#a0aec0",
                borderColor: lib.is_visible !== false ? "rgba(99, 179, 237, 0.3)" : "rgba(160, 174, 192, 0.3)",
              }}
              title={lib.is_visible !== false ? t("common.hide") : t("common.show")}
            >
              {lib.is_visible !== false ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          ) : (
            <>
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
                className={`${commonStyles.settingsSelect} ${styles.iconButton}`}
                style={{
                  color: lib.scan_status === "SCANNING" ? "#fc8181" : "#68d391",
                  borderColor: lib.scan_status === "SCANNING" ? "rgba(252, 129, 129, 0.3)" : "rgba(104, 211, 145, 0.3)",
                  cursor: "pointer",
                }}
                title={lib.scan_status === "SCANNING" ? t("sidebar.scan_cancel_tooltip") : t("sidebar.scan_tooltip")}
              >
                {lib.scan_status === "SCANNING" ? (
                  <Square
                    size={16}
                    fill="currentColor"
                  />
                ) : (
                  <RefreshCw size={16} />
                )}
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
            </>
          )}
        </div>
      </div>

      {editingLibrary?.id === lib.id && (
        <div className={styles.editForm}>
          <div className={styles.editGrid}>
            <div className={styles.flexOne}>
              <label className={styles.fieldLabel}>{t("settings.libraries.item.edit.name_label")}</label>
              <input
                type="text"
                value={editingLibrary.name}
                onChange={(e) => setEditingLibrary({ ...editingLibrary, name: e.target.value })}
                className={commonStyles.settingsInput}
                disabled={isSystem} // 시스템 라이브러리 이름 수정 불가
              />
            </div>
            {!isSystem && (
              <>
                <div className={styles.flexOne}>
                  <label className={styles.fieldLabel}>{t("settings.libraries.item.edit.view_mode_label")}</label>
                  <select
                    value={editingLibrary.default_view_mode}
                    onChange={(e) => setEditingLibrary({ ...editingLibrary, default_view_mode: e.target.value })}
                    className={commonStyles.settingsSelect}
                  >
                    <option value="single">{t("settings.viewer.mode.single")}</option>
                    <option value="double">{t("settings.viewer.mode.double")}</option>
                    <option value="vertical">{t("settings.viewer.mode.vertical")}</option>
                  </select>
                </div>
                <div className={styles.flexOne}>
                  <label className={styles.fieldLabel}>{t("settings.libraries.item.edit.read_direction_label")}</label>
                  <select
                    value={editingLibrary.default_read_direction}
                    onChange={(e) => setEditingLibrary({ ...editingLibrary, default_read_direction: e.target.value })}
                    className={commonStyles.settingsSelect}
                  >
                    <option value="ltr">{t("settings.viewer.direction.ltr")}</option>
                    <option value="rtl">{t("settings.viewer.direction.rtl")}</option>
                  </select>
                </div>
                <div className={styles.flexOne}>
                  <label className={styles.fieldLabel}>{t("viewer.settings.page_transition.label")}</label>
                  <select
                    value={editingLibrary.default_page_transition}
                    onChange={(e) => setEditingLibrary({ ...editingLibrary, default_page_transition: e.target.value })}
                    className={commonStyles.settingsSelect}
                  >
                    <option value="slide">{t("viewer.settings.page_transition.slide")}</option>
                    <option value="fade">{t("viewer.settings.page_transition.fade")}</option>
                    <option value="none">{t("viewer.settings.page_transition.none")}</option>
                  </select>
                </div>
                <div className={styles.flexOne}>
                  <label className={styles.fieldLabel}>{t("settings.libraries.item.edit.excludes_label")}</label>
                  <input
                    type="text"
                    value={editingLibrary.scan_excludes || ""}
                    onChange={(e) => setEditingLibrary({ ...editingLibrary, scan_excludes: e.target.value })}
                    className={commonStyles.settingsInput}
                    placeholder={t("settings.libraries.item.edit.excludes_placeholder")}
                  />
                </div>
              </>
            )}
            {isSystem && (
              <div className={styles.flexOne}>
                <p
                  className={styles.fieldLabel}
                  style={{ color: "#fc8181" }}
                >
                  {t("settings.libraries.item.edit.system_warning")}
                </p>
              </div>
            )}

            {isSystem ? (
              <div className={styles.editActions}>
                <button
                  onClick={() => setEditingLibrary(null)}
                  className={commonStyles.settingsSelect}
                  style={{ width: "auto", background: "transparent" }}
                >
                  {t("common.confirm")}
                </button>
              </div>
            ) : (
              <div className={styles.editActions}>
                <button
                  onClick={() => handleUpdateLibrary(lib.id, editingLibrary)}
                  className={commonStyles.settingsSelect}
                  style={{ width: "auto", background: "#4a5568" }}
                >
                  {t("common.save")}
                </button>
                <button
                  onClick={() => setEditingLibrary(null)}
                  className={commonStyles.settingsSelect}
                  style={{ width: "auto", background: "transparent" }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function LibrariesTab() {
  const { t } = useTranslation();
  const { libraries, isLoading, fetchLibraries: storeFetchLibraries, setLibraries } = useLibraryStore();
  const [isCreating, setIsCreating] = useState(false);
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [libraryToDelete, setLibraryToDelete] = useState<Library | null>(null);

  const user = useAuthStore((state) => state.user);
  const { startPolling, stopPolling } = useScanStore();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [newLibrary, setNewLibrary] = useState({
    name: "",
    path: "",
    default_view_mode: "single",
    default_read_direction: "ltr",
    default_page_transition: "slide",
    scan_excludes: "",
  });

  // Global Settings state
  const [scanInterval, setScanInterval] = useState("0");
  const [scanWatch, setScanWatch] = useState(false);
  const [scanPerformanceLevel, setScanPerformanceLevel] = useState("2");
  const [updatedSeriesPeriod, setUpdatedSeriesPeriod] = useState("7");

  // Load global settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await settingAPI.list();
        setScanInterval(settings.scan_interval || "0");
        setScanWatch(settings.scan_watch === "true");
        setScanPerformanceLevel(settings.scan_performance_level || "2");
        setUpdatedSeriesPeriod(settings.updated_series_period || "7");
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    };
    loadSettings();
  }, []);

  const handleScanIntervalChange = async (value: string) => {
    try {
      if (value === "realtime") {
        setScanWatch(true);
        setScanInterval("0");
        await Promise.all([
          settingAPI.update("scan_watch", { value: "true" }),
          settingAPI.update("scan_interval", { value: "0" }),
        ]);
      } else {
        setScanWatch(false);
        setScanInterval(value);
        await Promise.all([
          settingAPI.update("scan_watch", { value: "false" }),
          settingAPI.update("scan_interval", { value: value }),
        ]);
      }
      setStatus({ type: "success", message: t("settings.libraries.toast.saved") });
    } catch (error) {
      console.error("Failed to update scan settings:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.save_failed") });
    }
  };

  const handleUpdatedSeriesPeriodChange = async (value: string) => {
    try {
      setUpdatedSeriesPeriod(value);
      await settingAPI.update("updated_series_period", { value });
      setStatus({ type: "success", message: t("settings.libraries.toast.saved") });
    } catch (error) {
      console.error("Failed to update updated series period:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.save_failed") });
    }
  };

  const handleScanPerformanceLevelChange = async (value: string) => {
    try {
      setScanPerformanceLevel(value);
      await settingAPI.update("scan_performance_level", { value });
      setStatus({ type: "success", message: t("settings.libraries.toast.saved") });
    } catch (error) {
      console.error("Failed to update scan performance level:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.save_failed") });
    }
  };

  const fetchLibraries = useCallback(async () => {
    await storeFetchLibraries();
  }, [storeFetchLibraries]);

  useEffect(() => {
    fetchLibraries();
  }, [fetchLibraries]);

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
      setStatus({ type: "error", message: t("settings.libraries.toast.empty_fields") });
      return;
    }

    try {
      await libraryAPI.create(newLibrary);
      setStatus({ type: "success", message: t("settings.libraries.toast.created") });
      setIsCreating(false);
      setNewLibrary({
        name: "",
        path: "",
        default_view_mode: "single",
        default_read_direction: "ltr",
        default_page_transition: "slide",
        scan_excludes: "",
      });
      fetchLibraries();
    } catch (error: unknown) {
      console.error("Failed to create library:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.libraries.toast.create_failed") });
    }
  };

  const handleUpdateLibrary = async (id: string, data: Partial<Library>) => {
    try {
      await libraryAPI.update(id, data);
      setStatus({ type: "success", message: t("settings.libraries.toast.updated") });
      setEditingLibrary(null);
      fetchLibraries();
    } catch (error: unknown) {
      console.error("Failed to update library:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.libraries.toast.update_failed") });
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
      setStatus({ type: "success", message: t("settings.libraries.toast.deleted") });
      setIsDeleteModalOpen(false);
      setLibraryToDelete(null);
      fetchLibraries();
    } catch (error) {
      console.error("Failed to delete library:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.delete_failed") });
      setIsDeleteModalOpen(false);
    }
  };

  const handleScanLibrary = async (id: string) => {
    const library = libraries.find((l) => l.id === id);
    const isCurrentlyScanning = library?.scan_status === "SCANNING";

    try {
      if (isCurrentlyScanning) {
        await libraryAPI.cancelScan(id);
        stopPolling(); // 스캔 취소 시 진행률 폴링 중단
        setStatus({ type: "info", message: t("settings.libraries.toast.scan_canceled") });
        fetchLibraries();
        return;
      }

      setStatus({ type: "info", message: t("settings.libraries.toast.scan_started") });
      startPolling(); // 스캔 진행바 폴링 시작
      await libraryAPI.scan(id);
      setStatus({ type: "success", message: t("settings.libraries.toast.scan_completed") });
      fetchLibraries();
    } catch (error: unknown) {
      console.error("Failed to scan library:", error);
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 409) {
        setStatus({ type: "info", message: t("settings.libraries.toast.scan_running") });
      } else {
        setStatus({ type: "error", message: t("settings.libraries.toast.scan_failed") });
      }
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
          setStatus({ type: "error", message: t("settings.libraries.toast.order_failed") });
          fetchLibraries(); // Rollback
        }
      }
    },
    [libraries, setLibraries, fetchLibraries, t],
  );

  const handleToggleVisibility = async (lib: Library) => {
    try {
      const newIsVisible = lib.is_visible === false ? true : false;
      // Optimistic update
      const updatedLibraries = libraries.map((l) => (l.id === lib.id ? { ...l, is_visible: newIsVisible } : l));
      setLibraries(updatedLibraries);

      await libraryAPI.update(lib.id, { is_visible: newIsVisible });
      // No need for success toast for toggle to avoid spam
    } catch (error: unknown) {
      console.error("Failed to toggle visibility:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.visibility_failed") });
      fetchLibraries(); // Rollback
    }
  };

  return (
    <div className={`${commonStyles.tabContent} ${styles.relative}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}

      <div className={commonStyles.tabHeader}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <h2>{t("settings.libraries.title")}</h2>
            <p className={commonStyles.tabDescription}>{t("settings.libraries.desc")}</p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className={commonStyles.settingsSelect}
              style={{ width: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Plus size={16} />
              {t("settings.libraries.add_button")}
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <div className={`${commonStyles.settingsSection} ${styles.createForm}`}>
          <div className={commonStyles.sectionTitle}>
            <FolderOpen size={18} />
            <h3>{t("settings.libraries.add_title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.path_label")}</label>
                <p>{t("settings.libraries.path_desc")}</p>
              </div>
              <div className={`${commonStyles.itemControl} ${styles.inputGroup}`}>
                <input
                  type="text"
                  placeholder={t("settings.libraries.name_placeholder")}
                  value={newLibrary.name}
                  onChange={(e) => setNewLibrary({ ...newLibrary, name: e.target.value })}
                  className={commonStyles.settingsInput}
                />
                <input
                  type="text"
                  placeholder={t("settings.libraries.path_placeholder")}
                  value={newLibrary.path}
                  onChange={(e) => setNewLibrary({ ...newLibrary, path: e.target.value })}
                  className={commonStyles.settingsInput}
                />
              </div>
            </div>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.view_mode_label")}</label>
                <p>{t("settings.libraries.view_mode_desc")}</p>
              </div>
              <div className={`${commonStyles.itemControl} ${styles.selectGroup}`}>
                <select
                  value={newLibrary.default_view_mode}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_view_mode: e.target.value })}
                  className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                >
                  <option value="single">{t("settings.viewer.mode.single")}</option>
                  <option value="double">{t("settings.viewer.mode.double")}</option>
                  <option value="vertical">{t("settings.viewer.mode.vertical")}</option>
                </select>
                <select
                  value={newLibrary.default_read_direction}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_read_direction: e.target.value })}
                  className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                >
                  <option value="ltr">{t("settings.viewer.direction.ltr")}</option>
                  <option value="rtl">{t("settings.viewer.direction.rtl")}</option>
                </select>
                <select
                  value={newLibrary.default_page_transition}
                  onChange={(e) => setNewLibrary({ ...newLibrary, default_page_transition: e.target.value })}
                  className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                >
                  <option value="slide">{t("viewer.settings.page_transition.slide")}</option>
                  <option value="fade">{t("viewer.settings.page_transition.fade")}</option>
                  <option value="none">{t("viewer.settings.page_transition.none")}</option>
                </select>
              </div>
            </div>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.excludes_label")}</label>
                <p>{t("settings.libraries.excludes_desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <input
                  type="text"
                  placeholder={t("settings.libraries.excludes_placeholder")}
                  value={newLibrary.scan_excludes}
                  onChange={(e) => setNewLibrary({ ...newLibrary, scan_excludes: e.target.value })}
                  className={commonStyles.settingsInput}
                />
              </div>
            </div>
            <div className={styles.formActions}>
              <button
                onClick={() => setIsCreating(false)}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleCreateLibrary}
                className={commonStyles.settingsSelect}
                style={{ width: "auto", background: "#4a5568" }}
              >
                {t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.settingsGrid}>
        <div className={`${commonStyles.settingsSection} ${styles.globalSettings}`}>
          <div className={commonStyles.sectionTitle}>
            <RefreshCw size={18} />
            <h3>{t("settings.libraries.scan.title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.scan.performance_label")}</label>
                <p>{t("settings.libraries.scan.performance_desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  value={scanPerformanceLevel}
                  onChange={(e) => handleScanPerformanceLevelChange(e.target.value)}
                  className={commonStyles.settingsSelect}
                >
                  <option value="1">{t("settings.libraries.scan.level_1")}</option>
                  <option value="2">{t("settings.libraries.scan.level_2")}</option>
                  <option value="4">{t("settings.libraries.scan.level_4")}</option>
                </select>
              </div>
            </div>

            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.scan.interval_label")}</label>
                <p>{t("settings.libraries.scan.interval_desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  value={scanWatch ? "realtime" : scanInterval}
                  onChange={(e) => handleScanIntervalChange(e.target.value)}
                  className={commonStyles.settingsSelect}
                >
                  <option value="0">{t("settings.libraries.scan.manual")}</option>
                  <option value="realtime">{t("settings.libraries.scan.realtime")}</option>
                  <option value="30">{t("settings.libraries.scan.30min")}</option>
                  <option value="60">{t("settings.libraries.scan.1hr")}</option>
                  <option value="360">{t("settings.libraries.scan.6hr")}</option>
                  <option value="720">{t("settings.libraries.scan.12hr")}</option>
                  <option value="1440">{t("settings.libraries.scan.24hr")}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className={`${commonStyles.settingsSection} ${styles.globalSettings}`}>
          <div className={commonStyles.sectionTitle}>
            <Clock size={18} />
            <h3>{t("settings.libraries.updated.title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.updated.period_label")}</label>
                <p>{t("settings.libraries.updated.period_desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  value={updatedSeriesPeriod}
                  onChange={(e) => handleUpdatedSeriesPeriodChange(e.target.value)}
                  className={commonStyles.settingsSelect}
                  disabled={user?.role !== "MASTER"}
                >
                  <option value="1">{t("settings.libraries.updated.1day")}</option>
                  <option value="3">{t("settings.libraries.updated.3days")}</option>
                  <option value="7">{t("settings.libraries.updated.7days")}</option>
                  <option value="14">{t("settings.libraries.updated.14days")}</option>
                  <option value="30">{t("settings.libraries.updated.30days")}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={commonStyles.settingsSection}>
        <div className={commonStyles.sectionTitle}>
          <Folder size={18} />
          <h3>{t("settings.libraries.list_title")}</h3>
        </div>
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
                    onToggleVisibility={handleToggleVisibility}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {libraries.length === 0 && (
              <div className={commonStyles.placeholderContent}>{t("settings.libraries.empty")}</div>
            )}
          </div>
        )}
      </div>
      <AlertModal
        isOpen={isDeleteModalOpen}
        type="warning"
        title={t("settings.libraries.delete_modal.title")}
        message={t("settings.libraries.delete_modal.message", { name: libraryToDelete?.name })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
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
