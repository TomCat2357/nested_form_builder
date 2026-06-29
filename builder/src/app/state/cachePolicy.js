// Shared cache policy for forms and records
// SWR: show cache immediately, sync when stale, background refresh when older than background threshold

import {
  RECORD_CACHE_MAX_AGE_MS,
  RECORD_CACHE_BACKGROUND_REFRESH_MS,
  FORM_CACHE_MAX_AGE_MS,
  FORM_CACHE_BACKGROUND_REFRESH_MS,
} from "../../core/constants.js";

export {
  RECORD_CACHE_MAX_AGE_MS,
  RECORD_CACHE_BACKGROUND_REFRESH_MS,
};

/**
 * SWR 鮮度判定のコア。lastSyncedAt の経過時間と maxAgeMs / backgroundAgeMs の
 * しきい値から { age, shouldSync, shouldBackground, isFresh } を返す。
 *
 * forms / records / analytics の各ラッパー（下記）が定数を束ねて呼ぶのが通常経路だが、
 * 任意のしきい値で評価したい新エンティティ（例: formStore）はこのコアを直接使ってよい。
 */
export const evaluateCache = ({
  lastSyncedAt,
  hasData,
  forceSync = false,
  maxAgeMs = RECORD_CACHE_MAX_AGE_MS,
  backgroundAgeMs = RECORD_CACHE_BACKGROUND_REFRESH_MS,
}) => {
  const age = lastSyncedAt ? Date.now() - lastSyncedAt : Infinity;
  const shouldSync = forceSync || !hasData || age >= maxAgeMs;
  const shouldBackground = !shouldSync && age >= backgroundAgeMs;
  const isFresh = !shouldSync && !shouldBackground;
  return { age, shouldSync, shouldBackground, isFresh };
};

/** Form cache evaluation with pre-bound constants */
export const evaluateCacheForForms = ({ lastSyncedAt, hasData, forceSync }) =>
  evaluateCache({ lastSyncedAt, hasData, forceSync, maxAgeMs: FORM_CACHE_MAX_AGE_MS, backgroundAgeMs: FORM_CACHE_BACKGROUND_REFRESH_MS });

/**
 * Analytics（Question / Dashboard）一覧キャッシュの評価。
 * フォーム一覧と同じ SWR しきい値（1 時間で fresh、24 時間で要再取得）を共有する。
 */
export const evaluateCacheForAnalytics = ({ lastSyncedAt, hasData, forceSync }) =>
  evaluateCache({ lastSyncedAt, hasData, forceSync, maxAgeMs: FORM_CACHE_MAX_AGE_MS, backgroundAgeMs: FORM_CACHE_BACKGROUND_REFRESH_MS });

/** Record cache evaluation with pre-bound constants */
export const evaluateCacheForRecords = ({ lastSyncedAt, hasData, forceSync }) =>
  evaluateCache({ lastSyncedAt, hasData, forceSync, maxAgeMs: RECORD_CACHE_MAX_AGE_MS, backgroundAgeMs: RECORD_CACHE_BACKGROUND_REFRESH_MS });
