import { useEffect, useMemo, useState } from "react";
import { dataStore } from "../../app/state/dataStore.js";
import { saveChildEntriesToCache, getChildEntriesFromCache } from "../../app/state/recordsCache.js";

const EMPTY_MAP = new Map();

export const useChildEntriesWithCache = ({
  parentFormId,
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

    const loadData = async () => {
      // まずキャッシュから読み取り
      if (parentFormId) {
        try {
          const cached = await getChildEntriesFromCache(parentFormId);
          if (cached && alive) {
            const pairs = uniqueChildFormIds
              .filter((id) => cached[id])
              .map((childFormId) => {
                const form = typeof getFormById === "function" ? getFormById(childFormId) : null;
                const entries = Array.isArray(cached[childFormId]?.entries) ? cached[childFormId].entries : [];
                return [
                  childFormId,
                  {
                    entries: entries.map((entry) => ({ ...entry, __childFormId: childFormId })),
                    form,
                    loading: false,
                  },
                ];
              });
            if (pairs.length > 0) {
              setChildEntriesByFormId(new Map(pairs));
            }
          }
        } catch (error) {
          console.warn("[useChildEntriesWithCache] cache read failed:", error);
        }
      }

      // サーバーからフェッチ
      try {
        const pairs = await Promise.all(
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
        );

        if (!alive) return;
        const nextMap = new Map(pairs);
        setChildEntriesByFormId(nextMap);

        // キャッシュに保存
        if (parentFormId) {
          const cacheData = {};
          nextMap.forEach((value, childFormId) => {
            cacheData[childFormId] = {
              entries: (value.entries || []).map(({ __childFormId, ...rest }) => rest),
            };
          });
          saveChildEntriesToCache(parentFormId, cacheData).catch((err) => {
            console.warn("[useChildEntriesWithCache] cache save failed:", err);
          });
        }
      } catch (error) {
        console.error("[useChildEntriesWithCache] failed to load child entries:", error);
        if (alive && typeof showAlert === "function") {
          showAlert(`子フォームのデータ取得に失敗しました: ${error?.message || error}`);
        }
        if (alive) {
          setChildEntriesByFormId((prev) => (prev.size > 0 ? prev : EMPTY_MAP));
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      alive = false;
    };
  }, [enabled, getFormById, parentFormId, showAlert, uniqueChildFormIds]);

  return {
    childEntriesByFormId,
    loading,
  };
};
