import { useState, useCallback } from "react";

/**
 * Set ベースの選択状態を管理するフック
 * toggle / selectAll / clear / clearByIds を提供する
 */
export function useSetSelection() {
  const [selected, setSelected] = useState(() => new Set());

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const clearByIds = useCallback((ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  return { selected, setSelected, toggle, selectAll, clear, clearByIds };
}
