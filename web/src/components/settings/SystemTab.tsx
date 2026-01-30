import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const fetchVersion = useCallback(
    async (force = false) => {
      setIsLoading(true);
      try {
        const data = await systemAPI.getVersion(force);
        setVersionInfo(data);
        if (force) {
          setStatus({ type: "success", message: t("settings.system.toast.version_checked") });
        }
      } catch (error: unknown) {
        console.error("Failed to fetch version:", error);
        const err = error as { response?: { status?: number; data?: { error?: string } } };
        if (err.response?.status === 429) {
          setStatus({
            type: "error",
            message: err.response.data?.error || t("settings.system.toast.rate_limit_exceeded"),
          });
        } else {
          setStatus({ type: "error", message: t("settings.system.toast.check_failed") });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    fetchVersion();
  }, [fetchVersion]);

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
        <h2>{t("settings.system.title")}</h2>
        <p className={styles.tabDescription}>{t("settings.system.desc")}</p>
      </div>

      <div className={styles.settingsSections}>
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Info size={18} />
            <h3>{t("settings.system.version.title")}</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label>{t("settings.system.version.current")}</label>
                <p>{versionInfo?.current_version || t("common.checking")}</p>
              </div>
            </div>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label>{t("settings.system.version.latest")}</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <p>{versionInfo?.latest_version || t("common.checking")}</p>
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
                  {t("settings.system.version.check_button")}
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
                  <p style={{ margin: 0, fontWeight: "500", color: "#fbd38d" }}>
                    {t("settings.system.version.update_available_title")}
                  </p>
                  <p style={{ margin: "0.25rem 0 0.75rem", fontSize: "0.9rem", color: "rgba(255,255,255,0.7)" }}>
                    {t("settings.system.version.update_available_desc")}
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
                    {t("settings.system.version.visit_release_page")} <ExternalLink size={12} />
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
              {t("settings.system.version.rate_limit_note")}
            </p>
          </div>
        </section>

        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Server size={18} />
            <h3>{t("settings.system.server.title")}</h3>
          </div>
          <div className={styles.sectionContent}>
            <div
              className={styles.placeholderContent}
              style={{ minHeight: "100px" }}
            >
              <p>{t("settings.system.server.coming_soon")}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
