import { useEffect, useMemo, useState } from "react";
import { dataStore } from "../../app/state/dataStore.js";

const EMPTY_MAP = new Map();

export const useChildEntriesWithCache = ({
  childFormLinks,
  enabled,
  getFormById,
  showAlert,
}) => {
  const [childEntriesByFormId, setChildEntriesByFormId] = useState(EMPTY_MAP);
  const [loading, setLoading] = useState(false);

  const uniqueChildFormIds = useMemo(() => {
    const ids = [];
    const seen = new Set();
    (childFormLinks || []).forEach((link) => {
      const childFormId = String(link?.childFormId || "").trim();
      if (!childFormId || seen.has(childFormId)) return;
      seen.add(childFormId);
      ids.push(childFormId);
    });
    return ids;
  }, [childFormLinks]);

  useEffect(() => {
    if (!enabled || uniqueChildFormIds.length === 0) {
      setChildEntriesByFormId(EMPTY_MAP);
      setLoading(false);
      return undefined;
    }

    let alive = true;
    setLoading(true);

    Promise.all(
      uniqueChildFormIds.map(async (childFormId) => {
        const form = typeof getFormById === "function" ? getFormById(childFormId) : null;
        const result = await dataStore.listEntries(childFormId);
        const entries = Array.isArray(result?.entries) ? result.entries : [];
        return [
          childFormId,
          {
            entries: entries.map((entry) => ({ ...entry, __childFormId: childFormId })),
            form,
            loading: false,
          },
        ];
      }),
    )
      .then((pairs) => {
        if (!alive) return;
        setChildEntriesByFormId(new Map(pairs));
      })
      .catch((error) => {
        console.error("[useChildEntriesWithCache] failed to load child entries:", error);
        if (alive && typeof showAlert === "function") {
          showAlert(`子フォームのデータ取得に失敗しました: ${error?.message || error}`);
        }
        if (alive) {
          setChildEntriesByFormId(EMPTY_MAP);
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [enabled, getFormById, showAlert, uniqueChildFormIds]);

  return {
    childEntriesByFormId,
    loading,
  };
};
