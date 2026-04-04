import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AlertDialog from "../components/AlertDialog.jsx";

export const AlertContext = createContext(null);
const DEFAULT_TOAST_DURATION_MS = 20000;
const OUTPUT_ALERT_DURATION_MS = 24 * 60 * 60 * 1000;

const normalizeMessage = (message) =>
  message === undefined || message === null
    ? ""
    : typeof message === "string" || typeof message === "number"
      ? String(message)
      : message;

export function AlertProvider({ children }) {
  const [alerts, setAlerts] = useState([]);
  const nextIdRef = useRef(0);
  const timeoutMapRef = useRef(new Map());

  const closeAlert = useCallback((id) => {
    const timeoutId = timeoutMapRef.current.get(id);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutMapRef.current.delete(id);
    }
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  useEffect(() => () => {
    timeoutMapRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    timeoutMapRef.current.clear();
  }, []);

  const enqueueAlert = useCallback((message, { title = "通知", durationMs = DEFAULT_TOAST_DURATION_MS } = {}) => {
    const id = ++nextIdRef.current;
    setAlerts(prev => [...prev, { id, title, message: normalizeMessage(message), time: new Date() }]);
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return;

    const timeoutId = setTimeout(() => {
      closeAlert(id);
    }, duration);
    timeoutMapRef.current.set(id, timeoutId);
  }, [closeAlert]);

  const showAlert = useCallback((message, title = "通知") => {
    enqueueAlert(message, { title });
  }, [enqueueAlert]);

  const showToast = useCallback((message, { title = "通知", durationMs = DEFAULT_TOAST_DURATION_MS } = {}) => {
    enqueueAlert(message, { title, durationMs });
  }, [enqueueAlert]);

  const showOutputAlert = useCallback(({ title = "出力完了", message = "", url = "", linkLabel = "開く" } = {}) => {
    const content = url ? (
      <div className="nf-col nf-gap-8">
        <div>{normalizeMessage(message)}</div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="nf-link nf-fw-600">
          {linkLabel}
        </a>
      </div>
    ) : normalizeMessage(message);
    enqueueAlert(content, { title, durationMs: OUTPUT_ALERT_DURATION_MS });
  }, [enqueueAlert]);

  const value = useMemo(
    () => ({ showAlert, showToast, showOutputAlert }),
    [showAlert, showToast, showOutputAlert],
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
      <div className="alert-banner-container">
        {alerts.map(alert => (
          <AlertDialog
            key={alert.id}
            title={alert.title}
            message={alert.message}
            time={alert.time}
            onClose={() => closeAlert(alert.id)}
          />
        ))}
      </div>
    </AlertContext.Provider>
  );
}
