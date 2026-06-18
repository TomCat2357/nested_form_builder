/**
 * FormPage の loadEntry ロジック。
 *
 * FormPage.jsx の useEffect 本体から純関数として抽出。
 * React の依存はすべて `ctx` 引数経由で受け取る。
 *
 * 呼び出し側はこれを useEffect 内で wrap し、`mounted` フラグも保持する。
 */

import { dataStore } from "../app/state/dataStore.js";
import { getCachedEntryWithIndex } from "../app/state/recordsMemoryStore.js";
import { RECORD_CACHE_MAX_AGE_MS } from "../app/state/cachePolicy.js";
import { collectDefaultNowResponses } from "../utils/responses.js";
import { createEmptyDriveFolderStates } from "../utils/driveFolderState.js";
import { perfLogger } from "../utils/perfLogger.js";
import { toResponseObject } from "./formPageHelpers.js";

/**
 * 単一エントリのロード処理。
 *
 * @param {{getMounted: () => boolean}} runtime ライフサイクル制御
 * @param {object} ctx FormPage 由来のコンテキスト
 *
 * 期待する ctx フィールド:
 *   - formId, entryId, isFormLoaded
 *   - draftKey
 *   - responsesRef, isDirtyRef, normalizedSchemaRef
 *   - userNameRef, userEmailRef, userAffiliationRef, userTitleRef, userPhoneRef
 *   - newEntryInitKeyRef
 *   - initialResponsesRef, initialDriveFolderStatesRef
 *   - applyEntryToStateRef
 *   - applyOrDeferSyncedEntry
 *   - commitResponses
 *   - setDriveFolderStates, setLoading, setIsReloading
 */
export async function performFormPageEntryLoad(runtime, ctx) {
  const {
    formId,
    entryId,
    isFormLoaded,
    draftKey,
    responsesRef,
    isDirtyRef,
    normalizedSchemaRef,
    userNameRef,
    userEmailRef,
    userAffiliationRef,
    userTitleRef,
    userPhoneRef,
    newEntryInitKeyRef,
    initialResponsesRef,
    initialDriveFolderStatesRef,
    applyEntryToStateRef,
    applyOrDeferSyncedEntry,
    commitResponses,
    setDriveFolderStates,
    setLoading,
    setIsReloading,
  } = ctx;

  const tStart = performance.now();
  perfLogger.logVerbose("form-page", "loadEntry start", { formId, entryId });

  if (!formId || !isFormLoaded) {
    setLoading(false);
    return;
  }

  if (!entryId) {
    const newEntryKey = `${formId}:new`;
    const currentResponses = toResponseObject(responsesRef.current);
    const responseCount = Object.keys(currentResponses).length;

    if (newEntryInitKeyRef.current === newEntryKey) {
      setLoading(false);
      return;
    }

    let hasDraft = false;
    try {
      const savedStr = sessionStorage.getItem(draftKey);
      if (savedStr) {
        hasDraft = Object.keys(JSON.parse(savedStr)).length > 0;
      }
    } catch (_e) { /* ignore */ }

    if (responseCount > 0 || hasDraft) {
      newEntryInitKeyRef.current = newEntryKey;
      setLoading(false);
      return;
    }

    const initialResponses = collectDefaultNowResponses(normalizedSchemaRef.current, new Date(), {
      userName: userNameRef.current,
      userEmail: userEmailRef.current,
      userAffiliation: userAffiliationRef.current,
      userTitle: userTitleRef.current,
      userPhone: userPhoneRef.current,
    });
    const emptyStates = createEmptyDriveFolderStates();
    initialResponsesRef.current = initialResponses;
    initialDriveFolderStatesRef.current = emptyStates;
    setDriveFolderStates(emptyStates);
    commitResponses("loadEntry:new-entry-initialize", initialResponses, {
      forceLog: true,
      meta: {
        defaultKeyCount: Object.keys(initialResponses).length,
      },
    });
    newEntryInitKeyRef.current = newEntryKey;
    setLoading(false);
    return;
  }

  newEntryInitKeyRef.current = null;
  const currentResponses = toResponseObject(responsesRef.current);
  if (isDirtyRef.current && Object.keys(currentResponses).length > 0) {
    setLoading(false);
    return;
  }
  setLoading(true);

  const tBeforeGetEntry = performance.now();
  perfLogger.logVerbose("form-page", "before dataStore.getEntry", {
    elapsedFromStartMs: Number((tBeforeGetEntry - tStart).toFixed(2)),
    formId,
    entryId,
  });

  // まずキャッシュから取得を試みる
  const { entry: cachedEntry, rowIndex, lastSyncedAt } = await getCachedEntryWithIndex(formId, entryId);

  if (cachedEntry && runtime.getMounted()) {
    // キャッシュがあれば即座に表示
    applyEntryToStateRef.current(cachedEntry, entryId, "loadEntry:cache");
    setLoading(false);
    perfLogger.logVerbose("form-page", "cache displayed", {
      elapsedFromStartMs: Number((performance.now() - tStart).toFixed(2)),
      rowIndex,
    });

    // キャッシュ年齢を計算し、5分以上古い場合はバックグラウンド更新
    const cacheAge = lastSyncedAt ? Date.now() - lastSyncedAt : Infinity;
    const shouldBackground = cacheAge >= RECORD_CACHE_MAX_AGE_MS;

    if (shouldBackground) {
      perfLogger.logVerbose("form-page", "start background refresh", {
        cacheAgeMs: cacheAge,
        thresholdMs: RECORD_CACHE_MAX_AGE_MS,
        rowIndexHint: rowIndex,
      });
      setIsReloading(true);
      dataStore.getEntry(formId, entryId, { rowIndexHint: rowIndex }).then((freshData) => {
        if (!runtime.getMounted()) return;
        if (freshData && !isDirtyRef.current) {
          applyOrDeferSyncedEntry(freshData, "loadEntry:background-refresh");
          perfLogger.logVerbose("form-page", "background refresh complete", {
            elapsedFromStartMs: Number((performance.now() - tStart).toFixed(2)),
          });
        }
        setIsReloading(false);
      }).catch((error) => {
        console.error("[FormPage] background refresh failed:", error);
        setIsReloading(false);
      });
    } else {
      perfLogger.logVerbose("form-page", "cache is fresh; skip background refresh", {
        cacheAgeMs: cacheAge,
        thresholdMs: RECORD_CACHE_MAX_AGE_MS,
      });
    }
  } else {
    // キャッシュがない場合は同期読み取り（rowIndexがある場合は渡す）
    const data = await dataStore.getEntry(formId, entryId, rowIndex !== undefined ? { rowIndexHint: rowIndex } : {});

    const tAfterGetEntry = performance.now();
    perfLogger.logVerbose("form-page", "after dataStore.getEntry", {
      durationMs: Number((tAfterGetEntry - tBeforeGetEntry).toFixed(2)),
      rowIndexHint: rowIndex,
    });

    if (!runtime.getMounted()) return;
    const tBeforeApply = performance.now();
    if (data && !isDirtyRef.current) {
      applyOrDeferSyncedEntry(data, "loadEntry:sync-read");
    }
    const tAfterApply = performance.now();
    perfLogger.logVerbose("form-page", "applyEntryToState", {
      durationMs: Number((tAfterApply - tBeforeApply).toFixed(2)),
    });
    setLoading(false);

    const tEnd = performance.now();
    perfLogger.logVerbose("form-page", "loadEntry complete", {
      totalDurationMs: Number((tEnd - tStart).toFixed(2)),
      formId,
      entryId,
    });
  }
}
