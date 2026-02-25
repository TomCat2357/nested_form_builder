import { useEffect, useRef } from "react";

const OPERATION_KEYS = new Set([
  "Enter",
  " ",
  "Spacebar",
  "Backspace",
  "Delete",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

const isOperationKeyEvent = (event) => {
  if (!event || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  return OPERATION_KEYS.has(event.key);
};

export const useOperationCacheTrigger = ({
  onOperation,
  enabled = true,
  debounceMs = 500,
} = {}) => {
  const callbackRef = useRef(onOperation);
  const timeoutRef = useRef(null);

  useEffect(() => {
    callbackRef.current = onOperation;
  }, [onOperation]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return undefined;

    const runCallback = (source) => {
      if (typeof callbackRef.current !== "function") return;
      Promise.resolve(callbackRef.current({ source, triggeredAt: Date.now() })).catch((error) => {
        console.error("[useOperationCacheTrigger] onOperation failed:", error);
      });
    };

    const schedule = (source) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        runCallback(source);
      }, debounceMs);
    };

    const handleClick = () => schedule("click");
    const handleKeydown = (event) => {
      if (!isOperationKeyEvent(event)) return;
      schedule("keydown");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      schedule("visibilitychange");
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeydown, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [enabled, debounceMs]);
};
