import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { X, Save, Upload, Link, RotateCcw } from "lucide-react";
import type { Volume, Series } from "../../types/series";
import { volumeAPI } from "../../api/client";
import { AlertModal, type AlertType } from "./AlertModal";
import styles from "./EditVolumeModal.module.css";

interface EditVolumeModalProps {
  isOpen: boolean;
  onClose: () => void;
  volume: Volume;
  series: Series;
  onUpdate: (updatedVolume: Volume) => void;
}

export function EditVolumeModal({ isOpen, onClose, volume, series, onUpdate }: EditVolumeModalProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    title: "",
    volume_number: 0,
    authors: "",
    description: "",
    publication_year: "",
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

  useEffect(() => {
    if (isOpen && volume) {
      setFormData({
        title: volume.title || "",
        volume_number: volume.volume_number || 0,
        authors: volume.authors || "",
        description: volume.description || "",
        publication_year: volume.publication_year || "",
      });
      setThumbnailMode("file");
      setThumbnailUrl("");
      setIsDragging(false);
    }
  }, [isOpen, volume]);

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "volume_number" ? parseInt(value) || 0 : value,
    }));
  };

  const handleThumbnailChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await uploadFile(file);
    }
  };

  const uploadFile = async (file: File) => {
    try {
      await volumeAPI.uploadThumbnail(volume.id, file);
      const refreshed = await volumeAPI.get(volume.id);
      onUpdate(refreshed.data);
      showAlert("success", t("series.edit.alert.upload_success", "썸네일이 업로드되었습니다."));
    } catch (error) {
      console.error("Failed to upload thumbnail:", error);
      showAlert("error", t("series.edit.alert.upload_failed"));
    }
  };

  const handleUrlUpload = async () => {
    if (!thumbnailUrl) return;
    try {
      await volumeAPI.uploadThumbnailFromUrl(volume.id, thumbnailUrl);
      const refreshed = await volumeAPI.get(volume.id);
      onUpdate(refreshed.data);
      setThumbnailUrl("");
      showAlert("success", t("series.edit.alert.upload_success", "썸네일이 업로드되었습니다."));
    } catch (error) {
      console.error("Failed to upload thumbnail from URL:", error);
      showAlert("error", t("series.edit.alert.url_failed"));
    }
  };

  const handleResetThumbnail = () => {
    // 확인 모달 대신 바로 실행하거나 AlertModal을 확장해서 사용할 수 있음.
    // 여기서는 AlertModal을 Confirm 모드로 사용하는 로직이 이미 있으니 활용하지 않고,
    // 간단히 삭제 요청을 보냅니다. (혹은 별도 showConfirm 함수 추가 필요)
    // 기존 AlertModal 로직이 단순 메시지용이므로, 삭제 확인을 위한 showConfirm을 추가하거나 바로 삭제합니다.
    // 실수 방지를 위해 삭제 확인을 추가하는 것이 좋으므로 showConfirm을 구현합니다.

    // showConfirm 구현 (EditSeriesModal 참고)
    setAlertModal({
      isOpen: true,
      type: "warning",
      title: t("series.edit.thumbnail.reset"),
      message: t("series.edit.alert.reset_confirm_msg"),
      showCancel: true,
      onConfirm: async () => {
        try {
          await volumeAPI.deleteThumbnail(volume.id);
          const refreshed = await volumeAPI.get(volume.id);
          onUpdate(refreshed.data);
          setAlertModal((prev) => ({ ...prev, isOpen: false }));
          showAlert("success", t("series.edit.alert.reset_success"));
        } catch (error) {
          console.error("Failed to reset thumbnail:", error);
          showAlert("error", t("series.edit.alert.reset_failed"));
        }
      },
      onCancel: () => setAlertModal((prev) => ({ ...prev, isOpen: false })),
    });
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
      const res = await volumeAPI.update(volume.id, formData);
      onUpdate(res.data);
      onClose(); // 성공 시 모달 닫기
    } catch (error) {
      console.error("Failed to update volume:", error);
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
              <h2>{t("volume.edit.title", "볼륨 정보 수정")}</h2>
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
                    <label>권 번호</label>
                    <input
                      type="number"
                      name="volume_number"
                      value={formData.volume_number}
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
                      placeholder={series.metadata?.authors || ""}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>{t("series.edit.form.publication_year")}</label>
                    <input
                      type="text"
                      name="publication_year"
                      value={formData.publication_year}
                      onChange={handleChange}
                      placeholder={series.metadata?.publication_year || ""}
                    />
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
                      placeholder={series.description || ""}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <div
                  className={styles.modalActions}
                  style={{ marginLeft: "auto" }}
                >
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
