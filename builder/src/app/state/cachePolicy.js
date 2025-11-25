// Shared cache policy for forms and records
// SWR: show cache immediately, sync when stale, background refresh when older than background threshold

export const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
export const CACHE_BACKGROUND_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export const evaluateCache = ({
  lastSyncedAt,
  hasData,
  forceSync = false,
  maxAgeMs = CACHE_MAX_AGE_MS,
  backgroundAgeMs = CACHE_BACKGROUND_REFRESH_MS,
}) => {
  const age = lastSyncedAt ? Date.now() - lastSyncedAt : Infinity;
  const shouldSync = forceSync || !hasData || age >= maxAgeMs;
  const shouldBackground = !shouldSync && age >= backgroundAgeMs;
  return { age, shouldSync, shouldBackground };
};
