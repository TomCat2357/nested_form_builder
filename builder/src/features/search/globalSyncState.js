import { RECORD_CACHE_BACKGROUND_REFRESH_MS } from "../../app/state/cachePolicy.js";
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../../core/constants.js";


export const syncStateListeners = new Set();
export const globalSyncState = {
  loading: new Map(),
  background: new Map(),
  meta: new Map(),
};

export const defaultSyncMeta = {
  hasUnsynced: false,
  unsyncedCount: 0,
  waitingForLock: false,
  lastSyncedAt: null,
  lastSpreadsheetReadAt: null,
  useCache: false,
  cacheDisabled: false,
};

export const emitSyncStateChange = () => {
  syncStateListeners.forEach((listener) => listener());
};

export const updateSyncCounter = (counterMap, formId, isLoading) => {
  if (!formId) return;
  const current = counterMap.get(formId) || 0;
  if (isLoading) {
    counterMap.set(formId, current + 1);
    return;
  }
  if (current <= 1) {
    counterMap.delete(formId);
    return;
  }
  counterMap.set(formId, current - 1);
};

export const setGlobalSyncState = (formId, isLoading, isBackground) => {
  if (isBackground) updateSyncCounter(globalSyncState.background, formId, isLoading);
  else updateSyncCounter(globalSyncState.loading, formId, isLoading);
  emitSyncStateChange();
};

export const updateGlobalMeta = (formId, partialMeta = {}) => {
  if (!formId) return;
  const current = globalSyncState.meta.get(formId) || {};
  globalSyncState.meta.set(formId, { ...current, ...partialMeta });
  emitSyncStateChange();
};

export const getGlobalSyncSnapshot = (formId) => {
  if (!formId) {
    return {
      ...defaultSyncMeta,
      loading: false,
      backgroundLoading: false,
    };
  }
  const meta = { ...defaultSyncMeta, ...(globalSyncState.meta.get(formId) || {}) };
  return {
    loading: (globalSyncState.loading.get(formId) || 0) > 0,
    backgroundLoading: (globalSyncState.background.get(formId) || 0) > 0,
    waitingForLock: !!meta.waitingForLock,
    hasUnsynced: !!meta.hasUnsynced,
    unsyncedCount: Number.isFinite(Number(meta.unsyncedCount)) ? Number(meta.unsyncedCount) : 0,
    lastSyncedAt: meta.lastSyncedAt || null,
    lastSpreadsheetReadAt: meta.lastSpreadsheetReadAt || null,
    useCache: !!meta.useCache,
    cacheDisabled: !!meta.cacheDisabled,
  };
};

export const defaultAlert = { showAlert: (message) => console.warn("[useEntriesWithCache]", message) };

export const buildFetchErrorMessage = (error) =>
  `スプレッドシートからデータを読み取れませんでした。\n接続設定やスプレッドシートの共有設定を確認してください。\n\n詳細: ${error?.message || error}`;

export const shouldForceSync = (locationState) => {
  if (!locationState || typeof locationState !== "object") return false;
  return locationState.saved === true || locationState.deleted === true || locationState.created === true;
};

export const shouldRetryListReadError = (error) => {
  if (!error) return false;
  if (error.code === GAS_ERROR_CODE_LOCK_TIMEOUT) return false;
  const message = String(error?.message || error);
  return message.includes("スプレッドシート");
};

export const canRetryOperationSync = (error) => {
  if (!error) return false;
  if (error.code === GAS_ERROR_CODE_LOCK_TIMEOUT) return true;
  return shouldRetryListReadError(error);
};

export const getUnsyncedState = (cache) => {
  const cacheLastServerReadAt = Number.isFinite(Number(cache?.lastServerReadAt))
    ? Number(cache.lastServerReadAt)
    : (Number.isFinite(Number(cache?.lastSpreadsheetReadAt)) ? Number(cache.lastSpreadsheetReadAt) : 0);

  let unsyncedCount = 0;
  let unsyncedMaxModifiedAt = 0;
  (cache?.entries || []).forEach((entry) => {
    const modifiedAt = Number(entry?.modifiedAtUnixMs) || 0;
    if (modifiedAt <= cacheLastServerReadAt) return;
    unsyncedCount += 1;
    if (modifiedAt > unsyncedMaxModifiedAt) unsyncedMaxModifiedAt = modifiedAt;
  });

  return {
    cacheLastServerReadAt,
    unsyncedCount,
    unsyncedMaxModifiedAt,
    hasUnsynced: unsyncedCount > 0,
  };
};

export const LOCK_WAIT_RETRY_MS = 1000;
export const READ_RETRY_INTERVAL_MS = 1000;
export const READ_RETRY_MAX_ATTEMPTS = 3;
export const SYNC_INTERVAL_MS = RECORD_CACHE_BACKGROUND_REFRESH_MS;

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
