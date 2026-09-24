import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Loader2, Search, Sparkles } from "lucide-react";
import { seriesAPI } from "../api/client";
import type { Series } from "../types/series";
import type { MetadataCandidateItem, MetadataFetchResponse, MetadataResult, MetadataSearchResult } from "../types/plugin";
import { orderedOriginalTitles } from "../utils/originalTitles";
import { Toast } from "./common/Toast";
import commonStyles from "./settings/SettingsComponents.module.css";
import styles from "./SeriesMetadataPanel.module.css";

interface SeriesMetadataPanelProps {
  series: Series;
  onApplied: (response: import("../types/plugin").MetadataApplyResponse) => void;
  onFetched?: (response: MetadataFetchResponse | null) => void;
  onCharactersImported?: (count: number) => void;
  compact?: boolean;
}

type ApplyFieldKey = "thumbnail" | "original_title" | "authors" | "publisher" | "publication_date" | "description" | "tags" | "characters";

const DEFAULT_APPLY_FIELDS: Record<ApplyFieldKey, boolean> = {
  thumbnail: true,
  original_title: true,
  authors: true,
  publisher: true,
  publication_date: true,
  description: true,
  tags: true,
  characters: true,
};

export function SeriesMetadataPanel({ series, onApplied, onFetched, onCharactersImported, compact = false }: SeriesMetadataPanelProps) {
  const { t, i18n } = useTranslation();
  const originalTitleLanguageLabel = (language: string) =>
    language === "unknown" ? t("common.unknown") : t(`settings.general.language.${language}`);
  const [searchResult, setSearchResult] = useState<MetadataSearchResult | null>(null);
  const [fetched, setFetched] = useState<MetadataFetchResponse | null>(null);
  const [busy, setBusy] = useState<"search" | "fetch" | "apply" | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [searchTitle, setSearchTitle] = useState("");
  const [applyFields, setApplyFields] = useState<Record<ApplyFieldKey, boolean>>(DEFAULT_APPLY_FIELDS);

  const candidatesByProvider = useMemo(() => {
    const grouped = new Map<string, MetadataCandidateItem[]>();
    for (const item of searchResult?.candidates || []) {
      const items = grouped.get(item.plugin_id) || [];
      items.push(item);
      grouped.set(item.plugin_id, items);
    }

    return Array.from(grouped.entries())
      .map(([pluginId, items]) => ({
        pluginId,
        pluginName: items[0]?.plugin_name || pluginId,
        items,
      }))
      .sort((left, right) => left.pluginName.localeCompare(right.pluginName));
  }, [searchResult]);
  const previewOriginalTitles = orderedOriginalTitles(
    fetched?.result.original_titles,
    i18n?.language || "ko",
    fetched?.result.original_title || "",
  );
  const hasSelectedApplyField = Object.values(applyFields).some(Boolean);

  const handleSearch = async () => {
    setBusy("search");
    setFetched(null);
    onFetched?.(null);
    try {
      const response = await seriesAPI.metadataSearch(series.id, { title: searchTitle.trim() || undefined });
      setSearchResult(response);
      setSelectedKey(response.candidates[0] ? candidateKey(response.candidates[0]) : null);
      setStatus({ type: "success", message: t("series.metadata.toast.search_success") });
    } catch (error: unknown) {
      console.error("Failed to search metadata:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("series.metadata.toast.search_failed") });
    } finally {
      setBusy(null);
    }
  };

  const handleCandidateClick = async (item: MetadataCandidateItem) => {
    const key = candidateKey(item);
    setSelectedKey(key);
    setBusy("fetch");
    try {
      const response = await seriesAPI.metadataFetch(series.id, {
        plugin_id: item.plugin_id,
        source: item.candidate.source,
      });
      setFetched(response);
      onFetched?.(response);
      setApplyFields(DEFAULT_APPLY_FIELDS);
      setStatus({ type: "success", message: t("series.metadata.toast.fetch_success") });
    } catch (error: unknown) {
      console.error("Failed to fetch metadata:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("series.metadata.toast.fetch_failed") });
    } finally {
      setBusy(null);
    }
  };

  const handleApply = async (result: MetadataResult) => {
    setBusy("apply");
    try {
      const response = await seriesAPI.metadataApply(series.id, filterMetadataResult(result, applyFields));
      let characterChangeCount = 0;
      let characterImportFailed = false;
      if (applyFields.characters && fetched?.plugin_id) {
        try {
          const importResponse = await seriesAPI.importCharacters(series.id, result.characters || [], fetched.plugin_id);
          characterChangeCount = importResponse.changed_count || 0;
          onCharactersImported?.(characterChangeCount);
        } catch (error: unknown) {
          console.error("Failed to import characters:", error);
          characterImportFailed = true;
        }
      }
      onApplied(response);
      const updatedFieldCount = response.updated_fields.length;
      setStatus({
        type: characterImportFailed ? "info" : "success",
        message: characterImportFailed
          ? t("series.metadata.toast.apply_success_with_character_warning", { count: updatedFieldCount })
          : updatedFieldCount > 0 || characterChangeCount > 0
            ? characterChangeCount > 0
              ? t("series.metadata.toast.apply_success_with_character_sync", {
                count: updatedFieldCount,
                characters: characterChangeCount,
              })
              : t("series.metadata.toast.apply_success", { count: updatedFieldCount })
            : t("series.metadata.toast.apply_no_changes"),
      });
    } catch (error: unknown) {
      console.error("Failed to apply metadata:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("series.metadata.toast.apply_failed") });
    } finally {
      setBusy(null);
    }
  };

  const handleApplyFieldToggle = (field: ApplyFieldKey) => {
    setApplyFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <section className={`${styles.metadataPanel} ${compact ? styles.compact : ""}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
          sticky
        />
      )}

      <div className={styles.metadataPanelHeader}>
        <div>
          <h2>{t("series.metadata.title")}</h2>
          <p>{t("series.metadata.desc")}</p>
        </div>
        <div className={styles.metadataSearchControls}>
          <input
            className={styles.metadataSearchInput}
            value={searchTitle}
            onChange={(event) => setSearchTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (!event.nativeEvent.isComposing && event.keyCode !== 229 && busy === null) {
                void handleSearch();
              }
            }}
            placeholder={series.title}
          />
          <button
            type="button"
            className={`${commonStyles.settingsSelect} ${styles.metadataSearchButton}`}
            onClick={() => void handleSearch()}
            disabled={busy !== null}
          >
            {busy === "search" ? <Loader2 size={14} className={commonStyles.loadingSpinner} /> : <Search size={14} />}
            <span>{t("series.metadata.search")}</span>
          </button>
        </div>
      </div>

      {searchResult?.query && (
        <div className={styles.metadataQueryInfo}>
          <strong>검색어</strong>
          <span>{searchResult.query.series_name || searchResult.query.local_title || searchTitle || series.title}</span>
        </div>
      )}

      {searchResult?.failures && searchResult.failures.length > 0 && (
        <div className={styles.metadataFailures}>
          {searchResult.failures.map((failure) => (
            <div key={`${failure.plugin_id}-${failure.message}`} className={styles.metadataFailureItem}>
              <strong>{failure.plugin_name}</strong>
              <span>{failure.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.metadataGrid}>
        <div className={styles.metadataColumn}>
          <div className={styles.metadataColumnHeader}>
            <Sparkles size={16} />
            <span>{t("series.metadata.candidates")}</span>
          </div>
          <div className={styles.metadataProviderGrid}>
            {candidatesByProvider.length ? (
              candidatesByProvider.map((provider) => (
                <section key={provider.pluginId} className={styles.metadataProviderColumn}>
                  <div className={styles.metadataProviderHeader}>
                    <span>{provider.pluginName}</span>
                    <small>{provider.items.length}건</small>
                  </div>
                  <div className={styles.metadataCandidates}>
                    {provider.items.map((item) => {
                      const key = candidateKey(item);
                      const isSelected = selectedKey === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`${styles.metadataCandidate} ${isSelected ? styles.selected : ""}`}
                          onClick={() => void handleCandidateClick(item)}
                          disabled={busy !== null}
                        >
                          <div className={styles.metadataCandidateBody}>
                            {item.candidate.cover_url ? (
                              <img
                                className={styles.metadataCandidateCover}
                                src={item.candidate.cover_url}
                                alt={item.candidate.title}
                                loading="lazy"
                              />
                            ) : (
                              <div className={styles.metadataCandidateCoverPlaceholder}>
                                <Database size={18} />
                              </div>
                            )}
                            <div className={styles.metadataCandidateContent}>
                              <div className={styles.metadataCandidateTop}>
                                <strong>{item.candidate.title}</strong>
                                <span>{Math.round(item.candidate.confidence * 100)}%</span>
                              </div>
                              {item.candidate.description && (
                                <p className={styles.metadataCandidateDescription}>{item.candidate.description}</p>
                              )}
                              <p>{item.candidate.authors?.join(", ") || "-"}</p>
                              <p>{item.candidate.reason || "-"}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              <div className={styles.metadataEmpty}>{t("series.metadata.empty_candidates")}</div>
            )}
          </div>
        </div>

        <div className={styles.metadataColumn}>
          <div className={styles.metadataColumnHeader}>
            <Database size={16} />
            <span>{t("series.metadata.preview")}</span>
          </div>
          {fetched?.result ? (
            <div className={styles.metadataPreview}>
              <div className={styles.metadataPreviewHeader}>
                {fetched.result.cover?.url && (
                  <div className={`${styles.metadataPreviewCoverSection} ${!applyFields.thumbnail ? styles.metadataPreviewSectionDisabled : ""}`}>
                    <div className={styles.metadataPreviewLabelRow}>
                      <label htmlFor="apply-field-thumbnail">썸네일</label>
                      <input
                        id="apply-field-thumbnail"
                        type="checkbox"
                        checked={applyFields.thumbnail}
                        onChange={() => handleApplyFieldToggle("thumbnail")}
                        className={styles.metadataApplyCheckbox}
                      />
                    </div>
                    <img
                      className={styles.metadataPreviewCover}
                      src={fetched.result.cover.url}
                      alt={fetched.result.title}
                      loading="lazy"
                    />
                  </div>
                )}
                <div className={styles.metadataPreviewHeaderContent}>
                  <div className={`${styles.metadataPreviewSection} ${styles.metadataPreviewHeroSection} ${!applyFields.original_title ? styles.metadataPreviewSectionDisabled : ""}`}>
                    <div className={styles.metadataPreviewLabelRow}>
                      <label htmlFor="apply-field-original-title">{t("series.metadata.fields.original_title")}</label>
                      <input
                        id="apply-field-original-title"
                        type="checkbox"
                        checked={applyFields.original_title}
                        onChange={() => handleApplyFieldToggle("original_title")}
                        className={styles.metadataApplyCheckbox}
                      />
                    </div>
                    {previewOriginalTitles.length ? (
                      <div className={styles.metadataOriginalTitleList}>
                        {previewOriginalTitles.map((item) => (
                          <div key={`${item.language}:${item.title}`} className={styles.metadataOriginalTitleItem}>
                            <span className={styles.metadataOriginalTitleLang}>{originalTitleLanguageLabel(item.language)}</span>
                            <p>{item.title}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>-</p>
                    )}
                  </div>
                  <div className={styles.metadataPreviewHeroMeta}>
                    <div className={`${styles.metadataPreviewMetaBlock} ${!applyFields.authors ? styles.metadataPreviewSectionDisabled : ""}`}>
                      <div className={styles.metadataPreviewLabelRow}>
                        <label htmlFor="apply-field-authors">{t("series.metadata.fields.authors")}</label>
                        <input
                          id="apply-field-authors"
                          type="checkbox"
                          checked={applyFields.authors}
                          onChange={() => handleApplyFieldToggle("authors")}
                          className={styles.metadataApplyCheckbox}
                        />
                      </div>
                      <p className={styles.metadataPreviewValue}>{fetched.result.authors?.join(", ") || "-"}</p>
                    </div>
                    <div className={`${styles.metadataPreviewMetaBlock} ${!applyFields.publisher ? styles.metadataPreviewSectionDisabled : ""}`}>
                      <div className={styles.metadataPreviewLabelRow}>
                        <label htmlFor="apply-field-publisher">{t("series.metadata.fields.publisher")}</label>
                        <input
                          id="apply-field-publisher"
                          type="checkbox"
                          checked={applyFields.publisher}
                          onChange={() => handleApplyFieldToggle("publisher")}
                          className={styles.metadataApplyCheckbox}
                        />
                      </div>
                      <p className={styles.metadataPreviewValue}>{fetched.result.publisher || "-"}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className={`${styles.metadataPreviewSection} ${!applyFields.publication_date ? styles.metadataPreviewSectionDisabled : ""}`}>
                <div className={styles.metadataPreviewLabelRow}>
                  <label htmlFor="apply-field-publication-date">{t("series.metadata.fields.publication_date")}</label>
                  <input
                    id="apply-field-publication-date"
                    type="checkbox"
                    checked={applyFields.publication_date}
                    onChange={() => handleApplyFieldToggle("publication_date")}
                    className={styles.metadataApplyCheckbox}
                  />
                </div>
                <p className={styles.metadataPreviewValue}>{fetched.result.publication_date || "-"}</p>
              </div>
              <div className={`${styles.metadataPreviewSection} ${!applyFields.description ? styles.metadataPreviewSectionDisabled : ""}`}>
                <div className={styles.metadataPreviewLabelRow}>
                  <label htmlFor="apply-field-description">{t("series.metadata.fields.description")}</label>
                  <input
                    id="apply-field-description"
                    type="checkbox"
                    checked={applyFields.description}
                    onChange={() => handleApplyFieldToggle("description")}
                    className={styles.metadataApplyCheckbox}
                  />
                </div>
                <p className={styles.metadataPreviewValue}>{fetched.result.description || "-"}</p>
              </div>
              <div className={`${styles.metadataPreviewSection} ${!applyFields.tags ? styles.metadataPreviewSectionDisabled : ""}`}>
                <div className={styles.metadataPreviewLabelRow}>
                  <label htmlFor="apply-field-tags">{t("series.metadata.fields.tags")}</label>
                  <input
                    id="apply-field-tags"
                    type="checkbox"
                    checked={applyFields.tags}
                    onChange={() => handleApplyFieldToggle("tags")}
                    className={styles.metadataApplyCheckbox}
                  />
                </div>
                <p className={styles.metadataPreviewValue}>{fetched.result.tags?.join(", ") || "-"}</p>
              </div>
              <div className={`${styles.metadataPreviewSection} ${!applyFields.characters ? styles.metadataPreviewSectionDisabled : ""}`}>
                <div className={styles.metadataPreviewLabelRow}>
                  <label htmlFor="apply-field-characters">{t("series.metadata.fields.characters")}</label>
                  <input
                    id="apply-field-characters"
                    type="checkbox"
                    checked={applyFields.characters}
                    onChange={() => handleApplyFieldToggle("characters")}
                    className={styles.metadataApplyCheckbox}
                  />
                </div>
                <p className={styles.metadataPreviewValue}>
                  {t("series.metadata.character_count", { count: fetched.result.characters?.length || 0 })}
                </p>
                {Boolean(fetched.result.characters?.length) && (
                  <p className={styles.metadataPreviewValue}>
                    {fetched.result.characters?.slice(0, 5).map((character) => character.name).join(", ")}
                    {(fetched.result.characters?.length || 0) > 5 ? " ..." : ""}
                  </p>
                )}
              </div>
              <button type="button" className={commonStyles.settingsSelect} onClick={() => void handleApply(fetched.result)} disabled={busy !== null || !hasSelectedApplyField}>
                {busy === "apply" ? <Loader2 size={14} className={commonStyles.loadingSpinner} /> : <Sparkles size={14} />}
                <span>{t("series.metadata.apply")}</span>
              </button>
            </div>
          ) : (
            <div className={styles.metadataEmpty}>{t("series.metadata.empty_preview")}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function candidateKey(item: MetadataCandidateItem) {
  return `${item.plugin_id}:${item.candidate.source.id}`;
}

function filterMetadataResult(result: MetadataResult, applyFields: Record<ApplyFieldKey, boolean>): MetadataResult {
  return {
    ...result,
    original_title: applyFields.original_title ? result.original_title : undefined,
    original_titles: applyFields.original_title ? result.original_titles : undefined,
    authors: applyFields.authors ? result.authors : undefined,
    publisher: applyFields.publisher ? result.publisher : undefined,
    publication_date: applyFields.publication_date ? result.publication_date : undefined,
    description: applyFields.description ? result.description : undefined,
    tags: applyFields.tags ? result.tags : undefined,
    cover: applyFields.thumbnail ? result.cover : undefined,
  };
}
