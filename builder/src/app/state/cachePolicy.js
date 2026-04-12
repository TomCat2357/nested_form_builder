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

const evaluateCache = ({
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

/** Record cache evaluation with pre-bound constants */
export const evaluateCacheForRecords = ({ lastSyncedAt, hasData, forceSync }) =>
  evaluateCache({ lastSyncedAt, hasData, forceSync, maxAgeMs: RECORD_CACHE_MAX_AGE_MS, backgroundAgeMs: RECORD_CACHE_BACKGROUND_REFRESH_MS });
