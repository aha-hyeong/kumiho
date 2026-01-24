import { useState, useEffect } from "react";
import styles from "./SettingsComponents.module.css";
import { Server, RefreshCw, Info, ExternalLink, AlertCircle } from "lucide-react";
import { systemAPI } from "../../api/client";
import { Toast } from "../common/Toast";

interface VersionInfo {
  current_version: string;
  latest_version: string;
  needs_update: boolean;
}

export function SystemTab() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const fetchVersion = async (force = false) => {
    setIsLoading(true);
    try {
      const data = await systemAPI.getVersion(force);
      setVersionInfo(data);
      if (force) {
        setStatus({ type: "success", message: "최신 버전 정보를 확인했습니다." });
      }
    } catch (error: unknown) {
      console.error("Failed to fetch version:", error);
      const err = error as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.status === 429) {
        setStatus({ type: "error", message: err.response.data?.error || "수동 확인 횟수가 초과되었습니다." });
      } else {
        setStatus({ type: "error", message: "버전 정보 조회에 실패했습니다." });
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVersion();
  }, []);

  return (
    <div className={styles.tabContent}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}

      <div className={styles.tabHeader}>
        <h2>시스템 정보</h2>
        <p className={styles.tabDescription}>서버 상태 확인 및 시스템 관리를 수행합니다.</p>
      </div>

      <div className={styles.settingsSections}>
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Info size={18} />
            <h3>버전 정보</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label>현재 버전</label>
                <p>{versionInfo?.current_version || "확인 중..."}</p>
              </div>
            </div>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label>최신 버전</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <p>{versionInfo?.latest_version || "확인 중..."}</p>
                  {versionInfo?.needs_update && (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        background: "#f6ad55",
                        color: "#1a202c",
                        padding: "0.1rem 0.5rem",
                        borderRadius: "12px",
                        fontWeight: "bold",
                      }}
                    >
                      Update Available
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.itemControl}>
                <button
                  onClick={() => fetchVersion(true)}
                  disabled={isLoading}
                  className={styles.settingsSelect}
                  style={{
                    width: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    background: "rgba(255,255,255,0.05)",
                  }}
                >
                  <RefreshCw
                    size={14}
                    className={isLoading ? styles.spin : ""}
                  />
                  업데이트 확인
                </button>
              </div>
            </div>
            {versionInfo?.needs_update && (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "1rem",
                  background: "rgba(246, 173, 85, 0.1)",
                  borderRadius: "8px",
                  border: "1px solid rgba(246, 173, 85, 0.2)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                }}
              >
                <AlertCircle
                  size={18}
                  style={{ color: "#f6ad55", marginTop: "2px" }}
                />
                <div>
                  <p style={{ margin: 0, fontWeight: "500", color: "#fbd38d" }}>새로운 버전이 출시되었습니다.</p>
                  <p style={{ margin: "0.25rem 0 0.75rem", fontSize: "0.9rem", color: "rgba(255,255,255,0.7)" }}>
                    깃허브에서 새로운 기능을 확인하고 업데이트를 진행하세요.
                  </p>
                  <a
                    href="https://github.com/aha-hyeong/kumiho/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      fontSize: "0.85rem",
                      color: "#63b3ed",
                      textDecoration: "none",
                    }}
                  >
                    릴리즈 페이지 방문 <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            )}
            <p
              style={{
                marginTop: "1rem",
                fontSize: "0.8rem",
                color: "rgba(255,255,255,0.4)",
              }}
            >
              ※ 수동 업데이트 확인은 하루 10회로 제한됩니다.
            </p>
          </div>
        </section>

        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Server size={18} />
            <h3>서버 상태</h3>
          </div>
          <div className={styles.sectionContent}>
            <div
              className={styles.placeholderContent}
              style={{ minHeight: "100px" }}
            >
              <p>시스템 통계 기능이 곧 제공될 예정입니다.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
