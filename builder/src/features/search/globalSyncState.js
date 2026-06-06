import { RECORD_CACHE_BACKGROUND_REFRESH_MS } from "../../app/state/cachePolicy.js";
import { toErrorMessage } from "../../utils/errorMessage.js";
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

export const hasAnyUnsynced = () => {
  for (const meta of globalSyncState.meta.values()) {
    if (meta?.hasUnsynced) return true;
  }
  return false;
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

// ---------------------------------------------------------------------------
// オフラインファースト保存（フォーム/クエスチョン/ダッシュボード）のアップロード状態。
// レコード（Sheets）同期の meta / hasAnyUnsynced とは別ドメインなので別名前空間で持つ。
// AppLayout のグローバルインジケーターが購読し、SearchToolbar のレコード同期表示とは併存する。
// ---------------------------------------------------------------------------
export const uploadSyncState = {
  uploading: 0, // 現在アップロード中のジョブ数（>0 で「同期中」）
  pending: { form: 0, question: 0, dashboard: 0 }, // 未アップロード件数（種類別）
  lastError: null, // 直近のアップロードエラー文言（手動再試行の判断用）
};

export const uploadSyncListeners = new Set();
export const emitUploadSyncChange = () => {
  uploadSyncListeners.forEach((listener) => listener());
};

export const setUploadUploading = (count) => {
  uploadSyncState.uploading = Math.max(0, Number(count) || 0);
  emitUploadSyncChange();
};

export const setUploadPending = (countsByType = {}) => {
  uploadSyncState.pending = {
    form: Math.max(0, Number(countsByType.form) || 0),
    question: Math.max(0, Number(countsByType.question) || 0),
    dashboard: Math.max(0, Number(countsByType.dashboard) || 0),
  };
  emitUploadSyncChange();
};

export const setUploadLastError = (message) => {
  uploadSyncState.lastError = message || null;
  emitUploadSyncChange();
};

export const totalPendingUpload = () =>
  Object.values(uploadSyncState.pending).reduce((acc, n) => acc + (Number(n) || 0), 0);

export const hasAnyPendingUpload = () => totalPendingUpload() > 0;

export const defaultAlert = { showAlert: (message) => console.warn("[useEntries]", message) };

export const buildFetchErrorMessage = (error) =>
  `スプレッドシートからデータを読み取れませんでした。\n接続設定やスプレッドシートの共有設定を確認してください。\n\n詳細: ${toErrorMessage(error)}`;

export const shouldForceSync = (locationState) => {
  if (!locationState || typeof locationState !== "object") return false;
  return locationState.saved === true || locationState.deleted === true || locationState.created === true;
};

export const shouldRetryListReadError = (error) => {
  if (!error) return false;
  if (error.code === GAS_ERROR_CODE_LOCK_TIMEOUT) return false;
  const message = String(toErrorMessage(error));
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
export const WRITE_RETRY_INTERVAL_MS = 1000;
export const WRITE_RETRY_MAX_ATTEMPTS = 3;
export const SYNC_INTERVAL_MS = RECORD_CACHE_BACKGROUND_REFRESH_MS;

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
