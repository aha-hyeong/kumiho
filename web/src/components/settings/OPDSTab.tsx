import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Copy, RefreshCw, Check, AlertCircle, Rss } from "lucide-react";
import { authAPI } from "../../api/client";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./OPDSTab.module.css";

export function OPDSTab() {
  const { t } = useTranslation();
  const [opdsKey, setOpdsKey] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOPDSKey = async () => {
    try {
      setIsLoading(true);
      const response = await authAPI.getOPDSKey();
      setOpdsKey(response.data.opds_key);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch OPDS key:", err);
      setError(t("settings.opds.fetch_error"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOPDSKey();
  }, []);

  const handleRegenerate = async () => {
    if (!window.confirm(t("settings.opds.regenerate_confirm"))) return;

    try {
      setIsRegenerating(true);
      const response = await authAPI.regenerateOPDSKey();
      setOpdsKey(response.data.opds_key);
      setError(null);
    } catch (err) {
      console.error("Failed to regenerate OPDS key:", err);
      alert(t("settings.opds.regenerate_error"));
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCopy = () => {
    const url = `${window.location.origin}/api/v1/opds?key=${opdsKey}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return <div className={styles.loading}>{t("common.loading")}</div>;
  }

  const displayUrl = opdsKey ? `${window.location.origin}/api/v1/opds?key=${opdsKey}` : t("settings.opds.no_key");

  return (
    <div className={commonStyles.tabContent}>
      <div className={commonStyles.tabHeader}>
        <h2>{t("settings.opds.title")}</h2>
        <p className={commonStyles.tabDescription}>{t("settings.opds.description")}</p>
      </div>

      <div className={commonStyles.settingsSections}>
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <Rss size={18} />
            <h3>{t("settings.opds.url_label")}</h3>
          </div>

          <div className={styles.section}>
            <div className={styles.inputGroup}>
              <input
                type="text"
                className={styles.input}
                value={displayUrl}
                readOnly
              />
              <button
                className={styles.iconButton}
                onClick={handleCopy}
                disabled={!opdsKey}
                title={t("common.copy")}
              >
                {copied ? (
                  <Check
                    size={18}
                    className={styles.successIcon}
                  />
                ) : (
                  <Copy size={18} />
                )}
              </button>
            </div>
            <p className={styles.hint}>{t("settings.opds.url_hint")}</p>
          </div>
        </section>

        <section className={commonStyles.settingsSection}>
          <div className={styles.dangerZone}>
            <div className={styles.dangerInfo}>
              <h4>{t("settings.opds.regenerate_title")}</h4>
              <p>{t("settings.opds.regenerate_description")}</p>
            </div>
            <button
              className={styles.dangerButton}
              onClick={handleRegenerate}
              disabled={isRegenerating}
            >
              <RefreshCw
                size={18}
                className={isRegenerating ? styles.spinning : ""}
              />
              {t("settings.opds.regenerate_btn")}
            </button>
          </div>
        </section>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
