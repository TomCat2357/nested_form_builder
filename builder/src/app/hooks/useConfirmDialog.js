import { useCallback, useState } from "react";

export function useConfirmDialog(initialExtra = {}) {
  const [state, setState] = useState({ open: false, ...initialExtra });

  const open = useCallback(
    (overrides = {}) => setState((prev) => ({ ...prev, open: true, ...overrides })),
    [],
  );

  const close = useCallback(
    () => setState((prev) => ({ ...prev, open: false })),
    [],
  );

  const reset = useCallback(
    () => setState({ open: false, ...initialExtra }),
    [],
  );

  return { state, open, close, reset, setState };
}
