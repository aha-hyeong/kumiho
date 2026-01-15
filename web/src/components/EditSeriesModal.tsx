import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Save, Upload, Link, RotateCcw } from "lucide-react";
import type { Series } from "../types/series";
import { seriesAPI } from "../api/client";
import { AlertModal, type AlertType } from "./AlertModal";
import "./SeriesInfoCard.css"; // Reusing some styles or add new ones

interface EditSeriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  series: Series;
  onUpdate: (updatedSeries: Series) => void;
}

export function EditSeriesModal({ isOpen, onClose, series, onUpdate }: EditSeriesModalProps) {
  const [formData, setFormData] = useState({
    title: "",
    authors: "",
    status: "COMPLETED",
    tags: "",
    description: "",
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
        authors: series.authors || "",
        status: series.status || "COMPLETED",
        tags: series.tags || "",
        description: series.description || "",
      });
      setThumbnailMode("file");
      setThumbnailUrl("");
      setIsDragging(false);
    }
  }, [isOpen, series]);

  // 브라우저 기본 드래그 앤 드롭 동작(파일 열기 및 오버레이 등) 방지
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
      // 시리즈 데이터 refetch하여 캐시 무효화
      const refreshed = await seriesAPI.get(series.id);
      onUpdate(refreshed.data);
    } catch (error) {
      console.error("Failed to upload thumbnail:", error);
      showAlert("error", "썸네일 업로드에 실패했습니다.");
    }
  };

  const handleUrlUpload = async () => {
    if (!thumbnailUrl) return;
    try {
      await seriesAPI.uploadThumbnailFromUrl(series.id, thumbnailUrl);
      // 시리즈 데이터 refetch하여 캐시 무효화
      const refreshed = await seriesAPI.get(series.id);
      onUpdate(refreshed.data);
      setThumbnailUrl("");
    } catch (error) {
      console.error("Failed to upload thumbnail from URL:", error);
      showAlert("error", "이미지 다운로드에 실패했습니다. 유효한 이미지 URL인지 확인해주세요.");
    }
  };

  const handleResetThumbnail = () => {
    showConfirm(
      "썸네일을 초기화하시겠습니까? (기본 이미지로 돌아갑니다)",
      async () => {
        try {
          await seriesAPI.deleteThumbnail(series.id);
          // 시리즈 데이터 refetch하여 캐시 무효화
          const refreshed = await seriesAPI.get(series.id);
          onUpdate(refreshed.data);
          showAlert("success", "썸네일이 초기화되었습니다.");
        } catch (error) {
          console.error("Failed to reset thumbnail:", error);
          showAlert("error", "썸네일 초기화에 실패했습니다.");
        }
      },
      "썸네일 초기화"
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
      // 사용자의 요청으로 저장 후 페이지 새로고침
      window.location.reload();
    } catch (error) {
      console.error("Failed to update series:", error);
      showAlert("error", "시리즈 정보 수정에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {createPortal(
        <div
          className="modal-overlay"
          onClick={onClose}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>시리즈 정보 수정</h2>
              <button
                className="btn-icon"
                onClick={onClose}
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="edit-form"
            >
              <div className="edit-form-grid">
                <div className="edit-form-left">
                  <div className="form-group">
                    <label>썸네일 변경</label>
                    <div className="thumbnail-upload-tabs">
                      <button
                        type="button"
                        className={`tab-btn ${thumbnailMode === "file" ? "active" : ""}`}
                        onClick={() => setThumbnailMode("file")}
                      >
                        <Upload size={14} /> 파일 업로드
                      </button>
                      <button
                        type="button"
                        className={`tab-btn ${thumbnailMode === "url" ? "active" : ""}`}
                        onClick={() => setThumbnailMode("url")}
                      >
                        <Link size={14} /> URL 입력
                      </button>
                      <button
                        type="button"
                        className="tab-btn"
                        onClick={handleResetThumbnail}
                        title="썸네일 초기화"
                        style={{ marginLeft: "auto" }}
                      >
                        <RotateCcw size={14} /> 초기화
                      </button>
                    </div>

                    {thumbnailMode === "file" ? (
                      <div
                        className={`thumbnail-dropzone ${isDragging ? "dragging" : ""}`}
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
                        <p>클릭하거나 이미지를 드래그하세요</p>
                      </div>
                    ) : (
                      <div className="url-input-group">
                        <input
                          type="text"
                          placeholder="이미지 URL 입력"
                          value={thumbnailUrl}
                          onChange={(e) => setThumbnailUrl(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={handleUrlUpload}
                        >
                          확인
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label>제목</label>
                    <input
                      type="text"
                      name="title"
                      value={formData.title}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>작가 (콤마로 구분)</label>
                    <input
                      type="text"
                      name="authors"
                      value={formData.authors}
                      onChange={handleChange}
                      placeholder="예: 추공, 장성락, 기소령"
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>연재 상태</label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleChange}
                      >
                        <option value="COMPLETED">완결</option>
                        <option value="ONGOING">연재 중</option>
                        <option value="HIATUS">휴재</option>
                        <option value="CANCELLED">연재 중단</option>
                      </select>
                    </div>
                    <div
                      className="form-group"
                      style={{ flex: 1 }}
                    >
                      <label>태그 (콤마로 구분)</label>
                      <input
                        type="text"
                        name="tags"
                        value={formData.tags}
                        onChange={handleChange}
                        placeholder="예: 판타지, 액션, 먼치킨"
                      />
                    </div>
                  </div>
                </div>

                <div className="edit-form-right">
                  <div className="form-group h-full">
                    <label>줄거리</label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      className="h-full"
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <div className="sync-option">
                  <label>
                    <input
                      type="checkbox"
                      disabled
                    />
                    <span style={{ marginLeft: "8px", color: "#a0aec0" }}>파일 동기화 (ComicInfo.xml) - 준비 중</span>
                  </label>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={onClose}
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      "저장 중..."
                    ) : (
                      <>
                        <Save size={18} /> 저장
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
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
