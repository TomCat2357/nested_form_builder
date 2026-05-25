import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { useBuilderSettings } from "../settings/settingsStore.js";
import { toUnixMs, formatUnixMsValue } from "../../utils/dateTime.js";
import { evaluateCacheForForms } from "../../app/state/cachePolicy.js";
import { useFolderBrowser } from "../folders/useFolderBrowser.js";
import FolderSearchBar from "../folders/FolderSearchBar.jsx";
import FolderBreadcrumbs from "../folders/FolderBreadcrumbs.jsx";
import FolderCard from "../folders/FolderCard.jsx";

export default function HomeForms() {
  const { forms, loadingForms, refreshForms, lastSyncedAt } = useAppData();
  const { settings } = useBuilderSettings();
  const navigate = useNavigate();

  const sortKey = settings?.formListSortKey || "modifiedAt";
  const sortOrder = settings?.formListSortOrder || "desc";

  const activeForms = useMemo(() => {
    const list = forms.filter((form) => !form.archived);
    const dir = sortOrder === "asc" ? 1 : -1;
    const titleOf = (form) => String(form?.settings?.formTitle || "");
    const msOf = (form) => {
      const ms = Number.isFinite(form?.modifiedAtUnixMs)
        ? form.modifiedAtUnixMs
        : toUnixMs(form?.modifiedAt);
      return Number.isFinite(ms) ? ms : 0;
    };
    list.sort((a, b) => {
      if (sortKey === "formTitle") {
        return titleOf(a).localeCompare(titleOf(b), "ja") * dir;
      }
      return (msOf(a) - msOf(b)) * dir;
    });
    return list;
  }, [forms, sortKey, sortOrder]);

  useEffect(() => {
    const decision = evaluateCacheForForms({
      lastSyncedAt,
      hasData: forms.length > 0,
    });
    if (decision.shouldSync && !loadingForms) {
      refreshForms({ reason: "home-forms-mount-sync", background: false });
    } else if (decision.shouldBackground && !loadingForms) {
      refreshForms({ reason: "home-forms-mount-background", background: true }).catch(console.error);
    }
  }, [lastSyncedAt, forms.length, loadingForms, refreshForms]);

  const handleSelect = (formId) => {
    navigate(`/search?form=${formId}`);
  };

  const browser = useFolderBrowser(activeForms, {
    getFolder: (form) => form.folder,
    getName: (form) => form.settings?.formTitle || "",
  });

  if (loadingForms) {
    return <p className="nf-text-subtle">読み込み中...</p>;
  }
  if (activeForms.length === 0) {
    return <p className="nf-text-subtle">登録済みのフォームがありません。</p>;
  }

  return (
    <div className="nf-col nf-gap-12">
      <FolderSearchBar value={browser.query} onChange={browser.setQuery} placeholder="フォーム名で検索（例: 売上。正規表現も可）" />
      <FolderBreadcrumbs breadcrumbs={browser.breadcrumbs} onNavigate={browser.goTo} hidden={browser.searching} />
      {browser.folders.length === 0 && browser.visibleItems.length === 0 ? (
        <p className="nf-text-subtle">{browser.searching ? "一致するフォームがありません。" : "このフォルダにフォームはありません。"}</p>
      ) : (
        <div className="main-list">
          {browser.folders.map((f) => (
            <FolderCard key={f.path} name={f.name} count={f.count} onOpen={() => browser.openFolder(f.path)} />
          ))}
          {browser.visibleItems.map((form) => (
            <div key={form.id} className="main-card" onClick={() => handleSelect(form.id)}>
              <h2 className="main-title">
                {form.settings?.formTitle || "(無題)"}
                {form.readOnly && <span className="nf-text-warning nf-fw-600 nf-text-12 nf-ml-8">【参照のみ】</span>}
              </h2>
              {form.description && <p className="nf-m-0 nf-text-muted nf-pre-wrap">{form.description}</p>}
              <div className="main-meta">
                最終更新: {formatUnixMsValue(form.modifiedAtUnixMs ?? form.modifiedAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
