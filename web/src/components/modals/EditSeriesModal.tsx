import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { X, Save, Upload, Link, RotateCcw } from "lucide-react";
import type { Series } from "../../types/series";
import { seriesAPI } from "../../api/client";
import { AlertModal, type AlertType } from "./AlertModal";
import styles from "./EditSeriesModal.module.css";

interface EditSeriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  series: Series;
  onUpdate: (updatedSeries: Series) => void;
}

export function EditSeriesModal({ isOpen, onClose, series, onUpdate }: EditSeriesModalProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    title: "",
    authors: "",
    status: "ONGOING",
    tags: "",
    description: "",
    publication_year: "",
    original_title: "",
    publisher: "",
    published_at: "",
    isbn: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [thumbnailMode, setThumbnailMode] = useState<"file" | "url">("file");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AlertModal 상태
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: AlertType;
    title?: string;
    message: string;
    showCancel?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    type: "info",
    message: "",
    onConfirm: () => {},
  });

  const showAlert = (type: AlertType, message: string, title?: string) => {
    setAlertModal({
      isOpen: true,
      type,
      title,
      message,
      showCancel: false,
      onConfirm: () => setAlertModal((prev) => ({ ...prev, isOpen: false })),
    });
  };

  const showConfirm = (message: string, onConfirm: () => void, title?: string) => {
    setAlertModal({
      isOpen: true,
      type: "warning",
      title,
      message,
      showCancel: true,
      onConfirm: () => {
        setAlertModal((prev) => ({ ...prev, isOpen: false }));
        onConfirm();
      },
      onCancel: () => setAlertModal((prev) => ({ ...prev, isOpen: false })),
    });
  };

  useEffect(() => {
    if (isOpen && series) {
      setFormData({
        title: series.title || "",
        authors: series.metadata?.authors || "",
        status: series.metadata?.status || "ONGOING",
        tags: series.metadata?.tags || "",
        description: series.description || "",
        publication_year: series.metadata?.publication_year || "",
        original_title: series.metadata?.original_title || "",
        publisher: series.metadata?.publisher || "",
        published_at: series.metadata?.published_at || "",
        isbn: series.metadata?.isbn || "",
      });
      setThumbnailMode("file");
      setThumbnailUrl("");
      setIsDragging(false);
    }
  }, [isOpen, series]);

  useEffect(() => {
    const handleWindowDragEvent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (isOpen) {
      window.addEventListener("dragenter", handleWindowDragEvent);
      window.addEventListener("dragover", handleWindowDragEvent);
      window.addEventListener("dragleave", handleWindowDragEvent);
      window.addEventListener("drop", handleWindowDragEvent);
    }

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEvent);
      window.removeEventListener("dragover", handleWindowDragEvent);
      window.removeEventListener("dragleave", handleWindowDragEvent);
      window.removeEventListener("drop", handleWindowDragEvent);
    };
  }, [isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleThumbnailChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await uploadFile(file);
    }
  };

  const uploadFile = async (file: File) => {
    try {
      await seriesAPI.uploadThumbnail(series.id, file);
      const refreshed = await seriesAPI.get(series.id);
      onUpdate(refreshed.data);
    } catch (error) {
      console.error("Failed to upload thumbnail:", error);
      showAlert("error", t("series.edit.alert.upload_failed"));
    }
  };

  const handleUrlUpload = async () => {
    if (!thumbnailUrl) return;
    try {
      await seriesAPI.uploadThumbnailFromUrl(series.id, thumbnailUrl);
      const refreshed = await seriesAPI.get(series.id);
      onUpdate(refreshed.data);
      setThumbnailUrl("");
    } catch (error) {
      console.error("Failed to upload thumbnail from URL:", error);
      showAlert("error", t("series.edit.alert.url_failed"));
    }
  };

  const handleResetThumbnail = () => {
    showConfirm(
      t("series.edit.alert.reset_confirm_msg"),
      async () => {
        try {
          await seriesAPI.deleteThumbnail(series.id);
          const refreshed = await seriesAPI.get(series.id);
          onUpdate(refreshed.data);
          showAlert("success", t("series.edit.alert.reset_success"));
        } catch (error) {
          console.error("Failed to reset thumbnail:", error);
          showAlert("error", t("series.edit.alert.reset_failed"));
        }
      },
      t("series.edit.alert.reset_confirm_title"),
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await uploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const res = await seriesAPI.update(series.id, formData);
      onUpdate(res.data);
      window.location.reload();
    } catch (error) {
      console.error("Failed to update series:", error);
      showAlert("error", t("series.edit.alert.update_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {createPortal(
        <div
          className={styles.modalOverlay}
          onClick={onClose}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2>{t("series.edit.title")}</h2>
              <button
                className={styles.btnIcon}
                onClick={onClose}
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className={styles.editForm}
            >
              <div className={styles.editFormGrid}>
                <div className={styles.editFormLeft}>
                  <div className={styles.formGroup}>
                    <label>{t("series.edit.thumbnail.label")}</label>
                    <div className={styles.thumbnailUploadTabs}>
                      <button
                        type="button"
                        className={`${styles.tabBtn} ${thumbnailMode === "file" ? styles.active : ""}`}
                        onClick={() => setThumbnailMode("file")}
                      >
                        <Upload size={14} /> {t("series.edit.thumbnail.tab_file")}
                      </button>
                      <button
                        type="button"
                        className={`${styles.tabBtn} ${thumbnailMode === "url" ? styles.active : ""}`}
                        onClick={() => setThumbnailMode("url")}
                      >
                        <Link size={14} /> {t("series.edit.thumbnail.tab_url")}
                      </button>
                      <button
                        type="button"
                        className={styles.tabBtn}
                        onClick={handleResetThumbnail}
                        title={t("series.edit.thumbnail.reset_tooltip")}
                        style={{ marginLeft: "auto" }}
                      >
                        <RotateCcw size={14} /> {t("series.edit.thumbnail.reset")}
                      </button>
                    </div>

                    {thumbnailMode === "file" ? (
                      <div
                        className={`${styles.thumbnailDropzone} ${isDragging ? styles.dragging : ""}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleThumbnailChange}
                          hidden
                          ref={fileInputRef}
                        />
                        <p>{t("series.edit.thumbnail.drag_drop")}</p>
                      </div>
                    ) : (
                      <div className={styles.urlInputGroup}>
                        <input
                          type="text"
                          placeholder={t("series.edit.thumbnail.url_placeholder")}
                          value={thumbnailUrl}
                          onChange={(e) => setThumbnailUrl(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={handleUrlUpload}
                        >
                          {t("series.edit.thumbnail.url_confirm")}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className={styles.formGroup}>
                    <label>{t("series.edit.form.title")}</label>
                    <input
                      type="text"
                      name="title"
                      value={formData.title}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>{t("series.edit.form.authors")}</label>
                    <input
                      type="text"
                      name="authors"
                      value={formData.authors}
                      onChange={handleChange}
                      placeholder={t("series.edit.form.authors_placeholder")}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>{t("series.edit.form.publication_year")}</label>
                    <input
                      type="text"
                      name="publication_year"
                      value={formData.publication_year}
                      onChange={handleChange}
                      placeholder={t("series.edit.form.publication_year_placeholder")}
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.original_title")}</label>
                      <input
                        type="text"
                        name="original_title"
                        value={formData.original_title}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.original_title_placeholder")}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.publisher")}</label>
                      <input
                        type="text"
                        name="publisher"
                        value={formData.publisher}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.publisher_placeholder")}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.published_at")}</label>
                      <input
                        type="text"
                        name="published_at"
                        value={formData.published_at}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.published_at_placeholder")}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.isbn")}</label>
                      <input
                        type="text"
                        name="isbn"
                        value={formData.isbn}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.isbn_placeholder")}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.status")}</label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleChange}
                      >
                        <option value="COMPLETED">{t("series.edit.form.status_options.completed")}</option>
                        <option value="ONGOING">{t("series.edit.form.status_options.ongoing")}</option>
                        <option value="HIATUS">{t("series.edit.form.status_options.hiatus")}</option>
                        <option value="CANCELLED">{t("series.edit.form.status_options.cancelled")}</option>
                      </select>
                    </div>
                    <div
                      className={styles.formGroup}
                      style={{ flex: 1 }}
                    >
                      <label>{t("series.edit.form.tags")}</label>
                      <input
                        type="text"
                        name="tags"
                        value={formData.tags}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.tags_placeholder")}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.editFormRight}>
                  <div className={`${styles.formGroup} ${styles.hFull}`}>
                    <label>{t("series.edit.form.description")}</label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      className={styles.hFull}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <div className={styles.syncOption}>
                  <label>
                    <input
                      type="checkbox"
                      disabled
                    />
                    <span style={{ marginLeft: "8px", color: "#a0aec0" }}>{t("series.edit.form.sync_file")}</span>
                  </label>
                </div>
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={onClose}
                  >
                    {t("series.edit.actions.cancel")}
                  </button>
                  <button
                    type="submit"
                    className={styles.btnPrimary}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      t("series.edit.actions.saving")
                    ) : (
                      <>
                        <Save size={18} /> {t("series.edit.actions.save")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        showCancel={alertModal.showCancel}
        onConfirm={alertModal.onConfirm}
        onCancel={alertModal.onCancel}
      />
    </>
  );
}
