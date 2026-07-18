import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Link, Loader2, Plus, RotateCcw, Save, Settings2, Trash2, Upload, Users, X } from "lucide-react";
import { seriesAPI } from "../api/client";
import type { Series, SeriesCharacter } from "../types/series";
import { Toast } from "./common/Toast";
import commonStyles from "./settings/SettingsComponents.module.css";
import styles from "./SeriesCharactersDrawer.module.css";

interface SeriesCharactersDrawerProps {
  series: Series;
  reloadToken?: number;
}

type BusyAction = "load" | null;
const NEW_CHARACTER_PREFIX = "new:";

export function SeriesCharactersDrawer({ series, reloadToken = 0 }: SeriesCharactersDrawerProps) {
  const { t } = useTranslation();
  const [characters, setCharacters] = useState<SeriesCharacter[]>([]);
  const [busy, setBusy] = useState<BusyAction>("load");
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; role: string; image_url: string }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingNewIds, setPendingNewIds] = useState<string[]>([]);
  const pendingNewIdsRef = useRef<string[]>([]);
  const seriesIdRef = useRef(series.id);

  useEffect(() => {
    pendingNewIdsRef.current = pendingNewIds;
  }, [pendingNewIds]);

  useEffect(() => {
    seriesIdRef.current = series.id;
  }, [series.id]);

  useEffect(() => () => {
    const pendingIds = pendingNewIdsRef.current;
    if (pendingIds.length === 0) {
      return;
    }
    const persistedPendingIds = pendingIds.filter((id) => !isPendingCharacter(id));
    if (persistedPendingIds.length === 0) {
      return;
    }
    void Promise.allSettled(persistedPendingIds.map((id) => seriesAPI.deleteCharacter(seriesIdRef.current, id)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setBusy("load");
      try {
        const response = await seriesAPI.getCharacters(series.id);
        if (cancelled) return;
        const next = response.characters || [];
        setCharacters(next);
        setDrafts(buildDrafts(next));
        setEditingId((prev) => (prev && next.some((item) => item.id === prev) ? prev : null));
        setPendingNewIds((prev) => prev.filter((id) => next.some((item) => item.id === id)));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load series characters:", error);
          setStatus({ type: "error", message: t("series.characters.toast.load_failed") });
        }
      } finally {
        if (!cancelled) {
          setBusy(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, series.id, t]);

  const setSaving = (id: string, value: boolean) => {
    setSavingIds((prev) => ({ ...prev, [id]: value }));
  };

  const syncCharacter = (item: SeriesCharacter) => {
    setCharacters((prev) => prev.map((current) => (current.id === item.id ? item : current)));
    setDrafts((prev) => ({
      ...prev,
      [item.id]: { name: item.name, role: item.role || "", image_url: item.image_url || "" },
    }));
  };

  const handleAdd = async () => {
    if (pendingNewIds.length > 0) {
      setEditingId(pendingNewIds[0]);
      return;
    }

    const tempId = `${NEW_CHARACTER_PREFIX}${Date.now()}`;
    const item: SeriesCharacter = {
      id: tempId,
      series_id: series.id,
      name: "",
      sort_order: -1,
      role: "",
      image_url: "",
      source_provider: "",
      source_character_id: "",
      source_relation_id: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setCharacters((prev) => [item, ...prev]);
    setDrafts((prev) => ({
      ...prev,
      [item.id]: { name: "", role: "", image_url: "" },
    }));
    setEditingId(item.id);
    setPendingNewIds((prev) => [item.id, ...prev]);
  };

  const handleSave = async (characterId: string) => {
    const draft = drafts[characterId];
    const current = characters.find((item) => item.id === characterId);
    if (!draft || !draft.name.trim()) {
      setStatus({ type: "error", message: t("series.characters.toast.name_required") });
      return;
    }
    setSaving(characterId, true);
    try {
      const response = isPendingCharacter(characterId)
        ? await seriesAPI.createCharacter(series.id, {
          name: draft.name.trim(),
          role: draft.role.trim() || undefined,
          image_url: draft.image_url.trim() || undefined,
        })
        : await seriesAPI.updateCharacter(series.id, characterId, {
          name: draft.name.trim(),
          role: draft.role.trim() || undefined,
          image_url: draft.image_url.trim() || (current && !isManagedImageURL(current.image_url) ? "" : undefined),
        });
      if (isPendingCharacter(characterId)) {
        replacePendingCharacter(characterId, response, setCharacters, setDrafts);
      } else {
        syncCharacter(response);
      }
      setEditingId(null);
      setPendingNewIds((prev) => prev.filter((id) => id !== characterId));
      setStatus({ type: "success", message: t("series.characters.toast.save_success") });
    } catch (error) {
      console.error("Failed to save character:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("series.characters.toast.save_failed") });
    } finally {
      setSaving(characterId, false);
    }
  };

  const handleDelete = async (characterId: string) => {
    if (isPendingCharacter(characterId)) {
      removePendingCharacter(characterId, setCharacters, setDrafts, setEditingId, setPendingNewIds);
      return;
    }
    try {
      await seriesAPI.deleteCharacter(series.id, characterId);
      setCharacters((prev) => prev.filter((item) => item.id !== characterId));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[characterId];
        return next;
      });
      setEditingId((prev) => (prev === characterId ? null : prev));
      setPendingNewIds((prev) => prev.filter((id) => id !== characterId));
    } catch (error) {
      console.error("Failed to delete character:", error);
      setStatus({ type: "error", message: t("series.characters.toast.delete_failed") });
    }
  };

  const handleCancelNew = async (characterId: string) => {
    removePendingCharacter(characterId, setCharacters, setDrafts, setEditingId, setPendingNewIds);
  };

  const handleUpload = async (characterId: string, file: File) => {
    if (isPendingCharacter(characterId)) {
      setStatus({ type: "error", message: t("series.characters.toast.save_failed") });
      return;
    }
    setSaving(characterId, true);
    try {
      const response = await seriesAPI.uploadCharacterImage(series.id, characterId, file);
      syncCharacter(response);
      setStatus({ type: "success", message: t("series.characters.toast.image_updated") });
    } catch (error) {
      console.error("Failed to upload character image:", error);
      setStatus({ type: "error", message: t("series.characters.toast.image_failed") });
    } finally {
      setSaving(characterId, false);
    }
  };

  const handleResetImage = async (characterId: string) => {
    if (isPendingCharacter(characterId)) {
      setDrafts((prev) => ({
        ...prev,
        [characterId]: { ...(prev[characterId] || { name: "", role: "", image_url: "" }), image_url: "" },
      }));
      return;
    }
    setSaving(characterId, true);
    try {
      const response = await seriesAPI.deleteCharacterImage(series.id, characterId);
      syncCharacter(response);
    } catch (error) {
      console.error("Failed to delete character image:", error);
      setStatus({ type: "error", message: t("series.characters.toast.image_failed") });
    } finally {
      setSaving(characterId, false);
    }
  };

  return (
    <section className={styles.drawer}>
      {status && <Toast type={status.type} message={status.message} onClose={() => setStatus(null)} sticky />}

      <div className={styles.actions}>
        <button type="button" className={commonStyles.settingsSelect} onClick={() => void handleAdd()}>
          <Plus size={14} />
          <span>{t("series.characters.add")}</span>
        </button>
      </div>

      {busy === "load" ? (
        <div className={styles.empty}><Loader2 size={18} className={commonStyles.loadingSpinner} /></div>
      ) : characters.length === 0 ? (
        <div className={styles.empty}>{t("series.characters.empty")}</div>
      ) : (
        <div className={styles.list}>
          {sortCharactersForDisplay(characters, pendingNewIds).map((item) => (
            <CharacterCard
              key={item.id}
              item={item}
              draft={drafts[item.id] || { name: item.name, role: item.role || "", image_url: item.image_url || "" }}
              editing={editingId === item.id}
              isNew={pendingNewIds.includes(item.id)}
              saving={Boolean(savingIds[item.id])}
              onToggleEdit={() => setEditingId((prev) => (prev === item.id ? null : item.id))}
              onDraftChange={(next) => setDrafts((prev) => ({ ...prev, [item.id]: next }))}
              onSave={() => void handleSave(item.id)}
              onCancelNew={() => void handleCancelNew(item.id)}
              onDelete={() => void handleDelete(item.id)}
              onUpload={(file) => void handleUpload(item.id, file)}
              onResetImage={() => void handleResetImage(item.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface CharacterCardProps {
  item: SeriesCharacter;
  draft: { name: string; role: string; image_url: string };
  editing: boolean;
  isNew: boolean;
  saving: boolean;
  onToggleEdit: () => void;
  onDraftChange: (next: { name: string; role: string; image_url: string }) => void;
  onSave: () => void;
  onCancelNew: () => void;
  onDelete: () => void;
  onUpload: (file: File) => void;
  onResetImage: () => void;
}

function CharacterCard({
  item,
  draft,
  editing,
  isNew,
  saving,
  onToggleEdit,
  onDraftChange,
  onSave,
  onCancelNew,
  onDelete,
  onUpload,
  onResetImage,
}: CharacterCardProps) {
  const { t } = useTranslation();

  return (
    <article className={styles.card}>
      {!editing ? (
        <div className={styles.summaryRow}>
          {item.image_url ? <img src={item.image_url} alt={item.name} className={styles.image} /> : <div className={styles.imagePlaceholder}><Users size={20} /></div>}
          <div className={styles.summaryContent}>
            <strong className={styles.summaryName}>{item.name}</strong>
            <p className={styles.summaryRole}>{t("series.characters.role_display", { role: item.role || "-" })}</p>
          </div>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.headerAction} onClick={onToggleEdit}>
              <Settings2 size={14} />
            </button>
            <button type="button" className={`${styles.headerAction} ${styles.deleteAction}`} onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.editRow}>
            <div className={styles.imageBlock}>
              {item.image_url ? <img src={item.image_url} alt={item.name} className={styles.image} /> : <div className={styles.imagePlaceholder}><Users size={20} /></div>}
              <div className={styles.imageActions}>
                <button type="button" className={styles.smallButton} onClick={() => document.getElementById(`file-${item.id}`)?.click()}>
                  <Upload size={12} />
                  <span>{t("series.characters.upload")}</span>
                </button>
                <button type="button" className={styles.smallButton} onClick={onResetImage}>
                  <RotateCcw size={12} />
                  <span>{t("series.characters.reset_image")}</span>
                </button>
                <input
                  id={`file-${item.id}`}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onUpload(file);
                      event.target.value = "";
                    }
                  }}
                />
              </div>
            </div>
            {!isNew && (
              <div className={styles.inlineActions}>
                <button type="button" className={styles.headerAction} onClick={onToggleEdit}>
                  <Settings2 size={14} />
                </button>
                <button type="button" className={`${styles.headerAction} ${styles.deleteAction}`} onClick={onDelete}>
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
          <div className={styles.field}>
            <label>{t("series.characters.fields.name")}</label>
            <input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} />
          </div>
          <div className={styles.field}>
            <label>{t("series.characters.fields.role")}</label>
            <input value={draft.role} onChange={(event) => onDraftChange({ ...draft, role: event.target.value })} />
          </div>
          <div className={styles.field}>
            <label>{t("series.characters.fields.image_url")}</label>
            <div className={styles.urlRow}>
              <span className={styles.urlIcon}><Link size={12} /></span>
              <input value={draft.image_url} onChange={(event) => onDraftChange({ ...draft, image_url: event.target.value })} />
            </div>
          </div>
          {isNew ? (
            <div className={styles.actionRow}>
              <button type="button" className={`${commonStyles.settingsSelect} ${styles.saveButton}`} onClick={onSave} disabled={saving}>
                {saving ? <Loader2 size={14} className={commonStyles.loadingSpinner} /> : <Save size={14} />}
                <span>{t("series.characters.save_new")}</span>
              </button>
              <button type="button" className={styles.cancelButton} onClick={onCancelNew} disabled={saving}>
                <X size={14} />
                <span>{t("series.characters.cancel")}</span>
              </button>
            </div>
          ) : (
            <button type="button" className={`${commonStyles.settingsSelect} ${styles.saveButton}`} onClick={onSave} disabled={saving}>
              {saving ? <Loader2 size={14} className={commonStyles.loadingSpinner} /> : <Save size={14} />}
              <span>{t("series.characters.save")}</span>
            </button>
          )}
        </>
      )}
    </article>
  );
}

function buildDrafts(items: SeriesCharacter[]) {
  return Object.fromEntries(items.map((item) => [item.id, {
    name: item.name,
    role: item.role || "",
    image_url: isManagedImageURL(item.image_url) ? "" : item.image_url || "",
  }]));
}

function isPendingCharacter(id: string) {
  return id.startsWith(NEW_CHARACTER_PREFIX);
}

function replacePendingCharacter(
  tempId: string,
  item: SeriesCharacter,
  setCharacters: Dispatch<SetStateAction<SeriesCharacter[]>>,
  setDrafts: Dispatch<SetStateAction<Record<string, { name: string; role: string; image_url: string }>>>,
) {
  setCharacters((prev) => prev.map((current) => (current.id === tempId ? item : current)));
  setDrafts((prev) => {
    const next = { ...prev };
    delete next[tempId];
    next[item.id] = {
      name: item.name,
      role: item.role || "",
      image_url: isManagedImageURL(item.image_url) ? "" : item.image_url || "",
    };
    return next;
  });
}

function removePendingCharacter(
  characterId: string,
  setCharacters: Dispatch<SetStateAction<SeriesCharacter[]>>,
  setDrafts: Dispatch<SetStateAction<Record<string, { name: string; role: string; image_url: string }>>>,
  setEditingId: Dispatch<SetStateAction<string | null>>,
  setPendingNewIds: Dispatch<SetStateAction<string[]>>,
) {
  setCharacters((prev) => prev.filter((item) => item.id !== characterId));
  setDrafts((prev) => {
    const next = { ...prev };
    delete next[characterId];
    return next;
  });
  setEditingId((prev) => (prev === characterId ? null : prev));
  setPendingNewIds((prev) => prev.filter((id) => id !== characterId));
}

function sortCharactersForDisplay(items: SeriesCharacter[], pendingNewIds: string[]) {
  const pendingOrder = new Map(pendingNewIds.map((id, index) => [id, index]));

  return [...items].sort((left, right) => {
    const leftPending = pendingOrder.has(left.id);
    const rightPending = pendingOrder.has(right.id);
    if (leftPending || rightPending) {
      if (leftPending && rightPending) {
        return pendingOrder.get(left.id)! - pendingOrder.get(right.id)!;
      }
      return leftPending ? -1 : 1;
    }

    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }

    return left.created_at.localeCompare(right.created_at);
  });
}

function isManagedImageURL(value?: string) {
  return Boolean(value && value.startsWith("/api/v1/series/"));
}
