import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { dataStore } from "./dataStore.js";
import { getFormsFromCache, saveFormsToCache } from "./formsCache.js";
import { useAuth } from "./authContext.jsx";
import { evaluateCacheForForms } from "./cachePolicy.js";
import { perfLogger } from "../../utils/perfLogger.js";
import { registerFormReconciler, registerFolderReconciler, startUploadWorker } from "./uploadWorker.js";
import { prefetchTopOpened } from "./prefetchTopOpened.js";
import {
  normalizeFolderPath,
  isUnderFolder,
  reassignEntityFolder,
  reparentFolders,
  renameFolderPaths,
  removeFolderSubtree,
} from "../../utils/folderTree.js";

const AppDataContext = createContext(null);

/**
 * Helper to save forms cache with consistent error handling
 */
const saveCacheWithErrorHandling = async (forms, loadFailures, setCacheDisabled, propertyStoreMode, logPrefix = "saveCache") => {
  try {
    await saveFormsToCache(forms, loadFailures, propertyStoreMode);
    console.log(`[${logPrefix}] Cache updated`);
  } catch (err) {
    console.warn(`[${logPrefix}] Failed to update cache:`, err);
    setCacheDisabled(true);
  }
};
export function AppDataProvider({ children }) {
  const { propertyStoreMode, isAdmin } = useAuth();
  const propertyStoreModeRef = useRef(propertyStoreMode);

  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  // 既存表示を保ったままバックグラウンドで一覧を取り直している間 true。
  const [refreshingForms, setRefreshingForms] = useState(false);
  const [error, setError] = useState(null);
  const [loadFailures, setLoadFailures] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [cacheDisabled, setCacheDisabled] = useState(false);
  // 登録簿の永続フォルダ（空フォルダ含む）。forms_list 応答 / キャッシュから同期。
  const [registeredFolders, setRegisteredFolders] = useState([]);
  const registeredFoldersRef = useRef(registeredFolders);
  useEffect(() => {
    registeredFoldersRef.current = registeredFolders;
  }, [registeredFolders]);

  // キャッシュ更新用にformsとloadFailuresの最新値を保持
  const formsRef = useRef(forms);
  const loadFailuresRef = useRef(loadFailures);

  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

  useEffect(() => {
    loadFailuresRef.current = loadFailures;
  }, [loadFailures]);

  const refreshForms = useCallback(async ({ reason = "unknown", background = false } = {}) => {
    if (!background) {
      setLoadingForms(true);
    } else {
      setRefreshingForms(true);
    }
    setError(null);
    const startedAt = Date.now();
    perfLogger.logVerbose("forms", "refresh start", { reason, background, startedAt });

    try {
      const apiCallStart = Date.now();
      const result = await dataStore.listForms({ includeArchived: true });

      const apiCallEnd = Date.now();
      const apiCallDuration = apiCallEnd - apiCallStart;

      const serverForms = result.forms || [];
      // まだ Drive へ上がっていないローカル pending フォームはサーバ応答に無いため保持マージする。
      // さもないと保存直後のフォームがサーバ再取得で消える（更新を押すまで反映されない根本原因）。
      // アップロード完了時の reconcileFormId が pendingUpload:false にするので次回取得で収束する。
      const pendingById = new Map(
        formsRef.current.filter((f) => f && f.pendingUpload).map((f) => [f.id, f])
      );
      const serverIds = new Set(serverForms.map((f) => f.id));
      const allForms = serverForms.map((f) => (pendingById.has(f.id) ? pendingById.get(f.id) : f));
      for (const [id, f] of pendingById) if (!serverIds.has(id)) allForms.unshift(f);
      const failures = result.loadFailures || [];
      const folders = Array.isArray(result.folders) ? result.folders : [];

      const averagePerForm = allForms.length > 0 ? Math.round(apiCallDuration / allForms.length) : 0;

      perfLogger.logVerbose("forms", "api call done", {
        apiDurationMs: apiCallDuration,
        count: allForms.length,
        avgPerFormMs: averagePerForm,
      });
      perfLogger.logFormGasRead(apiCallDuration, allForms.length);

      setForms(allForms);
      setLoadFailures(failures);
      setRegisteredFolders(folders);
      const syncedAt = Date.now();
      setLastSyncedAt(syncedAt);

      try {
        const cacheStart = Date.now();
        await saveFormsToCache(allForms, failures, propertyStoreModeRef.current, { stampSyncTime: true, folders });
        const cacheDuration = Date.now() - cacheStart;
        perfLogger.logFormCacheSave(cacheDuration, allForms.length);
        setCacheDisabled(false);
        perfLogger.logVerbose("forms", "saved to cache", { cacheDurationMs: cacheDuration, count: allForms.length });
      } catch (cacheErr) {
        console.warn("[AppDataProvider] Failed to save to cache:", cacheErr);
        setCacheDisabled(true);
      }

      const finishedAt = Date.now();
      const totalDuration = finishedAt - startedAt;

      perfLogger.logVerbose("forms", "refresh timing", {
        totalDurationMs: totalDuration,
        apiSharePct: Math.round(apiCallDuration / totalDuration * 100),
      });
      perfLogger.logVerbose("forms", "refresh success", {
        reason,
        formCount: allForms.length,
        loadFailures: failures.length,
        finishedAt,
      });
    } catch (err) {
      console.error("[AppDataProvider] フォーム取得エラー:", err);
      setError(err.message || "フォームの取得に失敗しました");
      const finishedAt = Date.now();
      perfLogger.logVerbose("forms", "refresh fail", { reason, startedAt, finishedAt, error: err?.message });
    } finally {
      if (!background) {
        setLoadingForms(false);
      } else {
        setRefreshingForms(false);
      }
    }
  }, []);

  useEffect(() => {
    // 起動時の読み込みロジック
    (async () => {
      const startedAt = Date.now();
      console.log("[AppDataProvider] Startup - checking cache...");
      let cacheApplied = false;
      let cachedForms = [];
      let cachedFailures = [];
      let cacheLastSyncedAt = null;

      try {
        // 1. キャッシュから即座に表示
        const cacheResult = await getFormsFromCache();
        cachedForms = cacheResult.forms || [];
        cachedFailures = cacheResult.loadFailures || [];
        if (Array.isArray(cacheResult.folders)) setRegisteredFolders(cacheResult.folders);
        cacheLastSyncedAt = cacheResult.lastSyncedAt || cacheResult.cacheTimestamp || null;
        const cachedPropertyStoreMode = cacheResult.propertyStoreMode || "";
        const cacheAge = cacheLastSyncedAt ? Date.now() - cacheLastSyncedAt : null;
        const hasCachedData = cachedForms.length > 0 || cachedFailures.length > 0 || !!cacheLastSyncedAt;

        // プロパティ保存モードが変わった場合はキャッシュを無効化して強制再同期
        if (hasCachedData && cachedPropertyStoreMode !== propertyStoreModeRef.current) {
          console.log("[AppDataProvider] Property store mode changed; forcing fresh sync", {
            cachedMode: cachedPropertyStoreMode,
            currentMode: propertyStoreModeRef.current,
          });
          await refreshForms({ reason: "mode-changed", background: false });
          setLoadingForms(false);
          return;
        }

        if (hasCachedData) {
          console.log("[AppDataProvider] Loaded from cache:", cachedForms.length, "forms (age:", cacheAge, "ms)");
          perfLogger.logFormCacheHit(cacheAge || 0, cachedForms.length);
          setForms(cachedForms);
          setLoadFailures(cachedFailures);
          setLastSyncedAt(cacheLastSyncedAt);
          cacheApplied = true;
        }

        const { age: cacheAgeMs, shouldSync, shouldBackground } = evaluateCacheForForms({
          lastSyncedAt: cacheLastSyncedAt,
          hasData: hasCachedData,
        });

        perfLogger.logVerbose("forms", "cache check", {
          cacheAgeMs,
          cacheApplied,
          shouldSync,
          shouldBackground,
        });

        if (shouldSync) {
          console.log("[AppDataProvider] Cache stale or missing; fetching synchronously", { cacheAgeMs, cacheLastSyncedAt, hasCachedData });
          await refreshForms({ reason: "startup-sync", background: false });
          setLoadingForms(false);
          return;
        }

        // cache is fresh enough for sync, stop loading spinner
        setLoadingForms(false);

        if (shouldBackground) {
          console.log("[AppDataProvider] Cache is fresh enough; background refresh scheduled");
          refreshForms({ reason: "startup-background", background: true }).catch((err) => {
            console.error("[AppDataProvider] Background refresh error:", err);
            setError(err.message || "フォームの取得に失敗しました");
          });
        }

        const finishedAt = Date.now();
        console.log("[AppDataProvider] Startup complete in", finishedAt - startedAt, "ms");
      } catch (err) {
        console.error("[AppDataProvider] Startup error:", err);
        setError(err.message || "フォームの取得に失敗しました");
        setCacheDisabled(true);
      } finally {
        if (!cacheApplied) {
          setLoadingForms(false);
        }
      }
    })();
  }, []);

  // 起動後アイドル時に、開いた履歴（openHistory）上位 N 件のレコードを先行プリフェッチする。
  // 初期ロードが落ち着いた（loadingForms=false）後に 1 回だけ起動。失敗しても起動を妨げない。
  const prefetchStartedRef = useRef(false);
  useEffect(() => {
    if (loadingForms || prefetchStartedRef.current) return;
    prefetchStartedRef.current = true;
    const run = () => { prefetchTopOpened().catch(() => {}); };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 5000 });
    } else {
      setTimeout(run, 0);
    }
  }, [loadingForms]);

  // Helper to DRY up form state updates and cache saving
  const updateFormsAndCache = useCallback(async (updaterFn, nextFailures, logPrefix) => {
    let updatedForms;
    setForms((prev) => {
      updatedForms = updaterFn([...prev]);
      formsRef.current = updatedForms;
      return updatedForms;
    });
    setLoadFailures(nextFailures);
    loadFailuresRef.current = nextFailures;
    await saveCacheWithErrorHandling(updatedForms, nextFailures, setCacheDisabled, propertyStoreModeRef.current, logPrefix);
  }, []);

  // バックグラウンドアップロード成功時に一時 ID(local_…) を実 fileId へ付け替える。
  // schema 関連（schema/schemaHash/displayInfo）はローカルを正として保持し、サーバが確定した
  // id / driveFileUrl / タイトル等を反映する（GAS は保存時に field id を落とすため、サーバ
  // schema から hash を取り直すと records cache を誤って無効化してしまうのを避ける）。
  const reconcileFormId = useCallback(async (tempId, savedForm) => {
    if (!savedForm || !savedForm.id) return;
    const realId = savedForm.id;
    await updateFormsAndCache((next) => {
      const local = next.find((form) => form.id === tempId) || null;
      const merged = {
        ...(local || {}),
        ...savedForm,
        schema: local?.schema ?? savedForm.schema,
        schemaHash: local?.schemaHash ?? savedForm.schemaHash,
        displayFieldSettings: local?.displayFieldSettings,
        importantFields: local?.importantFields,
        id: realId,
        pendingUpload: false,
      };
      const filtered = next.filter((form) => form.id !== tempId && form.id !== realId);
      filtered.unshift(merged);
      return filtered;
    }, loadFailuresRef.current, "reconcileFormId");
  }, [updateFormsAndCache]);

  // フォーム / フォルダ操作（move / rename / deleteFolder）の op ジョブがバックグラウンドで
  // 成功したら、サーバ確定の folders 一覧を静かに採用する（各フォームの folder はローカルが正）。
  const reconcileFolders = useCallback((folders) => {
    if (!Array.isArray(folders)) return;
    setRegisteredFolders(folders);
    saveFormsToCache(formsRef.current, loadFailuresRef.current, propertyStoreModeRef.current, { folders })
      .catch((err) => console.warn("[AppDataProvider] folder reconcile cache update failed:", err));
  }, []);

  // 起動時に reconcile コールバックを登録してからアップロードワーカーを開始する
  // （登録前にワーカーが走ると React 状態へ反映できないため、この順序が重要）。
  useEffect(() => {
    registerFormReconciler(reconcileFormId);
    registerFolderReconciler("form", reconcileFolders);
    startUploadWorker();
    return () => {
      registerFormReconciler(null);
      registerFolderReconciler("form", null);
    };
  }, [reconcileFormId, reconcileFolders]);

  const upsertFormsState = useCallback(async (nextForm) => {
    if (!nextForm || !nextForm.id) return;
    await updateFormsAndCache((next) => {
      const index = next.findIndex((form) => form.id === nextForm.id);
      if (index === -1) next.unshift(nextForm);
      else next[index] = nextForm;
      return next;
    }, loadFailuresRef.current, "upsertFormsState");
  }, [updateFormsAndCache]);

  const removeFormsState = useCallback(async (formIds) => {
    if (!Array.isArray(formIds) || formIds.length === 0) return;
    const targetIdSet = new Set(formIds.filter(Boolean));
    if (!targetIdSet.size) return;

    await updateFormsAndCache(
      (next) => next.filter((form) => !targetIdSet.has(form.id)),
      loadFailuresRef.current.filter((failure) => !targetIdSet.has(failure.id)),
      "removeFormsState"
    );
  }, [updateFormsAndCache]);

  const createForm = useCallback(async (payload, saveMode = "auto") => {
    // id ＝ Drive fileId へ統一。新規フォームはクライアントで id を採番せず、保存（ファイル作成）
    // 後に GAS が返す fileId を id として採用する。
    const savedForm = await dataStore.createForm(payload, saveMode);

    await upsertFormsState(savedForm);
    return savedForm;
  }, [upsertFormsState]);

  const updateForm = useCallback(async (formId, updates, saveMode = "auto") => {
    const existing = formsRef.current.find((form) => form.id === formId) || {};
    const preparedUpdates = {
      ...updates,
      createdAt: updates?.createdAt ?? existing.createdAt,
      createdAtUnixMs: updates?.createdAtUnixMs ?? existing.createdAtUnixMs,
      archived: updates?.archived ?? existing.archived,
      childOnly: updates?.childOnly ?? existing.childOnly,
      schemaVersion: updates?.schemaVersion ?? existing.schemaVersion,
      driveFileUrl: updates?.driveFileUrl ?? existing.driveFileUrl,
    };
    const savedForm = await dataStore.updateForm(formId, preparedUpdates, saveMode);

    await upsertFormsState(savedForm);
    return savedForm;
  }, [upsertFormsState]);

  const archiveForm = useCallback(async (formId) => {
    const existing = formsRef.current.find((form) => form.id === formId);
    if (existing) await upsertFormsState({ ...existing, archived: true });
    // 楽観的＋遅延: GAS 反映は write-behind の op ジョブへ（失敗は既存方針で裏リトライ）。
    void dataStore.archiveForm(formId);
    return existing ? { ...existing, archived: true } : null;
  }, [upsertFormsState]);

  const unarchiveForm = useCallback(async (formId) => {
    const existing = formsRef.current.find((form) => form.id === formId);
    if (existing) await upsertFormsState({ ...existing, archived: false });
    void dataStore.unarchiveForm(formId);
    return existing ? { ...existing, archived: false } : null;
  }, [upsertFormsState]);

  const batchUpdateFormsState = useCallback(async (dataStoreFn, formIds, optimisticPatch, logPrefix) => {
    const targetIds = Array.isArray(formIds) ? formIds.filter(Boolean) : [formIds].filter(Boolean);
    if (!targetIds.length) return { forms: [], updated: 0, errors: [] };

    const patchFn = typeof optimisticPatch === "function" ? optimisticPatch : (form) => ({ ...form, ...optimisticPatch });
    const targetIdSet = new Set(targetIds);
    const optimisticForms = formsRef.current.filter((form) => targetIdSet.has(form.id)).map((form) => patchFn(form));

    if (optimisticForms.length > 0) {
      await updateFormsAndCache((next) => {
        optimisticForms.forEach((form) => {
          const index = next.findIndex((f) => f.id === form.id);
          if (index !== -1) next[index] = form;
        });
        return next;
      }, loadFailuresRef.current, `${logPrefix}:optimistic`);
    }

    void dataStoreFn(targetIds)
      .then(async (result) => {
        if (!result?.forms || !Array.isArray(result.forms) || result.forms.length === 0) return;
        await updateFormsAndCache((next) => {
          result.forms.forEach((form) => {
            const index = next.findIndex((f) => f.id === form.id);
            if (index !== -1) next[index] = form;
          });
          return next;
        }, loadFailuresRef.current, `${logPrefix}:background`);
      });

    return { forms: optimisticForms, updated: optimisticForms.length, errors: [] };
  }, [updateFormsAndCache]);

  const archiveForms = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.archiveForms.bind(dataStore), formIds, { archived: true, readOnly: false, childOnly: false }, "archiveForms"),
    [batchUpdateFormsState],
  );

  const unarchiveForms = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.unarchiveForms.bind(dataStore), formIds, { archived: false }, "unarchiveForms"),
    [batchUpdateFormsState],
  );

  const setFormReadOnly = useCallback(async (formId) => {
    const existing = formsRef.current.find((form) => form.id === formId);
    if (existing) await upsertFormsState({ ...existing, readOnly: true, archived: false });
    void dataStore.setFormReadOnly(formId).then((res) => { if (res) upsertFormsState(res); });
    return existing ? { ...existing, readOnly: true, archived: false } : null;
  }, [upsertFormsState]);

  const clearFormReadOnly = useCallback(async (formId) => {
    const existing = formsRef.current.find((form) => form.id === formId);
    if (existing) await upsertFormsState({ ...existing, readOnly: false });
    void dataStore.clearFormReadOnly(formId).then((res) => { if (res) upsertFormsState(res); });
    return existing ? { ...existing, readOnly: false } : null;
  }, [upsertFormsState]);

  const setFormsReadOnly = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.setFormsReadOnly.bind(dataStore), formIds, { readOnly: true, archived: false, childOnly: false }, "setFormsReadOnly"),
    [batchUpdateFormsState],
  );

  const clearFormsReadOnly = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.clearFormsReadOnly.bind(dataStore), formIds, { readOnly: false }, "clearFormsReadOnly"),
    [batchUpdateFormsState],
  );

  const setFormsChildOnly = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.setFormsChildOnly.bind(dataStore), formIds, { childOnly: true, archived: false, readOnly: false }, "setFormsChildOnly"),
    [batchUpdateFormsState],
  );

  const clearFormsChildOnly = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.clearFormsChildOnly.bind(dataStore), formIds, { childOnly: false }, "clearFormsChildOnly"),
    [batchUpdateFormsState],
  );

  const deleteForms = useCallback(async (formIds) => {
    await removeFormsState(formIds);

    void dataStore.deleteForms(formIds).catch((err) => {
      console.error("[AppDataProvider] Background deleteForms failed:", err);
    });
  }, [removeFormsState]);

  const deleteForm = useCallback((formId) => deleteForms([formId]), [deleteForms]);

  // 「削除」: 楽観的にローカルから除去し、裏でプロジェクト内ファイルはゴミ箱へ移動する
  // （プロジェクト外はリンク解除のみ。判定は GAS 側がファイルごとに行う）。
  const deleteFormsWithFiles = useCallback(async (formIds) => {
    await removeFormsState(formIds);

    void dataStore.deleteFormsWithFiles(formIds).catch((err) => {
      console.error("[AppDataProvider] Background deleteFormsWithFiles failed:", err);
    });
  }, [removeFormsState]);

  const importForms = useCallback(async (jsonList) => {
    const created = await dataStore.importForms(jsonList);
    if (Array.isArray(created)) {
      // 複数フォームを一括追加してキャッシュも1回だけ更新
      setForms((prev) => {
        const next = [...created, ...prev];

        // キャッシュ更新
        saveCacheWithErrorHandling(next, loadFailuresRef.current, setCacheDisabled, propertyStoreModeRef.current, "importForms");

        return next;
      });
    }
    return created;
  }, []);

  const copyForm = useCallback(async (formId) => {
    const savedForm = await dataStore.copyForm(formId);
    if (savedForm) {
      await upsertFormsState(savedForm);
    }
    return savedForm;
  }, [upsertFormsState]);

  const exportForms = useCallback(async (formIds) => dataStore.exportForms(formIds), []);
  const getFormById = useCallback((formId) => forms.find((form) => form.id === formId) || null, [forms]);

  // 空フォルダを登録簿に追加。楽観的＋遅延: folders state/キャッシュを即時更新し、GAS 実体作成は
  // write-behind の op ジョブへ委ねる（フォーム自体は変わらない）。
  const createFolder = useCallback(async (path) => {
    const normalized = normalizeFolderPath(path);
    const current = registeredFoldersRef.current;
    if (!normalized) return current;
    const folders = current.some((p) => normalizeFolderPath(p) === normalized) ? current : [...current, normalized];
    setRegisteredFolders(folders);
    try {
      await saveFormsToCache(formsRef.current, loadFailuresRef.current, propertyStoreModeRef.current, { folders });
    } catch (err) {
      console.warn("[AppDataProvider] createFolder cache update failed:", err);
    }
    await dataStore.createFolder(path);
    return folders;
  }, []);

  // forms 状態と folders 登録簿を 1 回のキャッシュ書き込みで同時更新する（フォルダ操作用）。
  const persistFormsAndFolders = useCallback(async (nextForms, nextFolders, logPrefix) => {
    setForms(nextForms);
    formsRef.current = nextForms;
    setRegisteredFolders(nextFolders);
    try {
      await saveFormsToCache(nextForms, loadFailuresRef.current, propertyStoreModeRef.current, { folders: nextFolders });
    } catch (err) {
      console.warn(`[${logPrefix}] cache update failed:`, err);
      setCacheDisabled(true);
    }
  }, []);

  // フォーム/フォルダ移動。楽観的＋遅延: ローカル（state/キャッシュ/folders）を即時更新し、
  // GAS 移動は write-behind の op ジョブへ委ねる（dataStore.moveItems が enqueue）。
  const moveItems = useCallback(async (payload) => {
    const formIds = Array.isArray(payload?.formIds) ? payload.formIds : [];
    const folderPaths = Array.isArray(payload?.folderPaths) ? payload.folderPaths : [];
    const destPath = payload?.destPath || "";

    const nextForms = formsRef.current.map((form) => {
      const nf = reassignEntityFolder(form.folder, "move", { itemId: form.id, itemIds: formIds, folderPaths, destPath });
      return nf === normalizeFolderPath(form.folder) ? form : { ...form, folder: nf };
    });
    const nextFolders = reparentFolders(registeredFoldersRef.current, folderPaths, destPath);
    await persistFormsAndFolders(nextForms, nextFolders, "moveItems");

    return dataStore.moveItems(payload);
  }, [persistFormsAndFolders]);

  // フォルダ名変更（親は保持し leaf 名だけ変更）。配下フォームの folder prefix も即時書換え。
  const renameFolder = useCallback(async (payload) => {
    const path = payload?.path || "";
    const newName = payload?.newName || "";

    const nextForms = formsRef.current.map((form) => {
      const nf = reassignEntityFolder(form.folder, "rename", { path, newName });
      return nf === normalizeFolderPath(form.folder) ? form : { ...form, folder: nf };
    });
    const nextFolders = renameFolderPaths(registeredFoldersRef.current, path, newName);
    await persistFormsAndFolders(nextForms, nextFolders, "renameFolder");

    return dataStore.renameFolder(payload);
  }, [persistFormsAndFolders]);

  // フォルダ削除（配下フォームも削除）。ローカルから配下を即時除去し、保留ジョブも取り消す。
  const deleteFolder = useCallback(async (path) => {
    const target = normalizeFolderPath(path);
    const containedIds = formsRef.current.filter((form) => isUnderFolder(form.folder, target)).map((form) => form.id);
    const nextForms = formsRef.current.filter((form) => !isUnderFolder(form.folder, target));
    const nextFolders = removeFolderSubtree(registeredFoldersRef.current, target);
    await persistFormsAndFolders(nextForms, nextFolders, "deleteFolder");

    await dataStore.deleteFolder(path, { containedIds });
    return { folders: nextFolders, deletedFormCount: containedIds.length };
  }, [persistFormsAndFolders]);

  const registerImportedForm = useCallback(async (payload) => {
    const result = await dataStore.registerImportedForm(payload);
    if (result) {
      await upsertFormsState(result);
    }
    return result;
  }, [upsertFormsState]);

  const memoValue = useMemo(
    () => ({
      forms,
      loadFailures,
      loadingForms,
      refreshingForms,
      error,
      lastSyncedAt,
      cacheDisabled,
      registeredFolders,
      createFolder,
      moveItems,
      renameFolder,
      deleteFolder,
      refreshForms,
      createForm,
      updateForm,
      archiveForm,
      unarchiveForm,
      archiveForms,
      unarchiveForms,
      setFormReadOnly,
      clearFormReadOnly,
      setFormsReadOnly,
      clearFormsReadOnly,
      setFormsChildOnly,
      clearFormsChildOnly,
      deleteForms,
      deleteForm,
      deleteFormsWithFiles,
      importForms,
      exportForms,
      copyForm,
      getFormById,
      registerImportedForm,
    }),
    [forms, loadFailures, loadingForms, refreshingForms, error, lastSyncedAt, cacheDisabled, registeredFolders, createFolder, moveItems, renameFolder, deleteFolder, refreshForms, createForm, updateForm, archiveForm, unarchiveForm, archiveForms, unarchiveForms, setFormReadOnly, clearFormReadOnly, setFormsReadOnly, clearFormsReadOnly, setFormsChildOnly, clearFormsChildOnly, deleteForms, deleteForm, deleteFormsWithFiles, importForms, exportForms, copyForm, getFormById, registerImportedForm],
  );

  return <AppDataContext.Provider value={memoValue}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
