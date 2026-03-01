import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AlertDialog from "../components/AlertDialog.jsx";

export const AlertContext = createContext(null);
const DEFAULT_TOAST_DURATION_MS = 2500;

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
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutMapRef.current.delete(id);
    }
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  useEffect(() => () => {
    timeoutMapRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    timeoutMapRef.current.clear();
  }, []);

  const showAlert = useCallback((message, title = "通知") => {
    const id = ++nextIdRef.current;
    setAlerts(prev => [...prev, { id, title, message: normalizeMessage(message), time: new Date() }]);
  }, []);

  const showToast = useCallback((message, { title = "通知", durationMs = DEFAULT_TOAST_DURATION_MS } = {}) => {
    const id = ++nextIdRef.current;
    setAlerts(prev => [...prev, { id, title, message: normalizeMessage(message), time: new Date() }]);
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return;

    const timeoutId = setTimeout(() => {
      closeAlert(id);
    }, duration);
    timeoutMapRef.current.set(id, timeoutId);
  }, [closeAlert]);

  const value = useMemo(
    () => ({ showAlert, showToast }),
    [showAlert, showToast],
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
