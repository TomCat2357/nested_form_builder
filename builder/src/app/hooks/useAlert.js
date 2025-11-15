import { useState, useCallback } from "react";

export function useAlert() {
  const [alertState, setAlertState] = useState({ open: false, title: "", message: "" });

  const showAlert = useCallback((message, title = "通知") => {
    setAlertState({ open: true, title, message });
  }, []);

  const closeAlert = useCallback(() => {
    setAlertState({ open: false, title: "", message: "" });
  }, []);

  return { alertState, showAlert, closeAlert };
}
