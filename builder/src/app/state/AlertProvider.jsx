import React, { createContext, useCallback, useMemo, useRef, useState } from "react";
import AlertDialog from "../components/AlertDialog.jsx";

export const AlertContext = createContext(null);

export function AlertProvider({ children }) {
  const [alerts, setAlerts] = useState([]);
  const nextIdRef = useRef(0);

  const showAlert = useCallback((message, title = "通知") => {
    const normalizedMessage =
      message === undefined || message === null
        ? ""
        : typeof message === "string" || typeof message === "number"
          ? String(message)
          : message;
    const id = ++nextIdRef.current;
    setAlerts(prev => [...prev, { id, title, message: normalizedMessage, time: new Date() }]);
  }, []);

  const closeAlert = useCallback((id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const value = useMemo(
    () => ({ showAlert }),
    [showAlert],
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
