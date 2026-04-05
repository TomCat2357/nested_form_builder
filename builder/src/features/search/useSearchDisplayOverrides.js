import { useEffect, useState, useCallback } from "react";
import { loadSearchDisplayOverrides, saveSearchDisplayOverrides } from "../../core/storage.js";

export function useSearchDisplayOverrides(formId) {
  const [overrides, setOverrides] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!formId) {
      setOverrides(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadSearchDisplayOverrides(formId).then((loaded) => {
      setOverrides(loaded || {});
      setLoading(false);
    });
  }, [formId]);

  const updateOverride = useCallback(async (key, value) => {
    setOverrides((prev) => {
      const next = { ...(prev || {}), [key]: value };
      saveSearchDisplayOverrides(formId, next);
      return next;
    });
  }, [formId]);

  return { overrides, updateOverride, loading };
}
