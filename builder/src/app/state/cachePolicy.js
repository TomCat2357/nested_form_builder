// Shared cache policy for forms and records
// SWR: show cache immediately, sync when stale, background refresh when older than background threshold

// Records: 5min hard refresh, 1min background refresh
export const RECORD_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
export const RECORD_CACHE_BACKGROUND_REFRESH_MS = 1 * 60 * 1000;

// Forms: 1h hard refresh, 10min background refresh
export const FORM_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
export const FORM_CACHE_BACKGROUND_REFRESH_MS = 10 * 60 * 1000;

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
  return { age, shouldSync, shouldBackground };
};
