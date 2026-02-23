import React, { createContext, useCallback, useMemo, useState } from "react";
import AlertDialog from "../components/AlertDialog.jsx";

export const AlertContext = createContext(null);

export function AlertProvider({ children }) {
  const [alertState, setAlertState] = useState({ open: false, title: "", message: "" });

  const showAlert = useCallback((message, title = "通知") => {
    setAlertState({
      open: true,
      title,
      message: message === undefined || message === null ? "" : String(message),
    });
  }, []);

  const closeAlert = useCallback(() => {
    setAlertState({ open: false, title: "", message: "" });
  }, []);

  const value = useMemo(
    () => ({ alertState, showAlert, closeAlert }),
    [alertState, showAlert, closeAlert],
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
      <AlertDialog
        open={alertState.open}
        title={alertState.title}
        message={alertState.message}
        onClose={closeAlert}
      />
    </AlertContext.Provider>
  );
}
