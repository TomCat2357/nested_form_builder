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
  FORM_CACHE_MAX_AGE_MS,
  FORM_CACHE_BACKGROUND_REFRESH_MS,
};

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
