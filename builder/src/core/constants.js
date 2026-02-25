// UI・動作関連
export const MAX_DEPTH = 11;
export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_SHEET_NAME = "Data";

// IndexedDB ストレージ関連
export const DB_NAME = "NestedFormBuilder";
export const DB_VERSION = 4;
export const STORE_NAMES = {
  forms: "formsCache",
  records: "recordsCache",
  recordsMeta: "recordsCacheMeta",
  settings: "settingsStore",
};

// キャッシュポリシー（ミリ秒）
export const RECORD_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
export const RECORD_CACHE_BACKGROUND_REFRESH_MS = 1 * 60 * 1000;
export const FORM_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
export const FORM_CACHE_BACKGROUND_REFRESH_MS = 1 * 60 * 1000;

// 日時処理関連
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const SERIAL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
