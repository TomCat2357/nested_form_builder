import React, { createContext, useContext, useMemo } from "react";

/**
 * 認証コンテキスト
 * GASから注入されたグローバル変数を読み取り、管理者判定とフォームIDを提供
 */
const AuthContext = createContext({
  isAdmin: true,
  formId: "",
  authError: "",
  userEmail: "",
  userName: "",
  propertyStoreMode: "script",
  adminSettingsEnabled: true,
});

/**
 * 認証プロバイダー
 * window.__IS_ADMIN__ と window.__FORM_ID__ と window.__AUTH_ERROR__ を読み取る
 */
export function AuthProvider({ children }) {
  const value = useMemo(() => {
    // GASから注入されたグローバル変数を読み取る
    // 未定義の場合はデフォルトで管理者モード（開発環境用）
    const isAdmin = typeof window !== "undefined" && window.__IS_ADMIN__ !== undefined
      ? Boolean(window.__IS_ADMIN__)
      : true;

    const formId = typeof window !== "undefined" && window.__FORM_ID__
      ? String(window.__FORM_ID__)
      : "";

    const authError = typeof window !== "undefined" && window.__AUTH_ERROR__
      ? String(window.__AUTH_ERROR__)
      : "";

    const userEmail = typeof window !== "undefined" && window.__USER_EMAIL__
      ? String(window.__USER_EMAIL__)
      : "";

    const userName = typeof window !== "undefined" && window.__USER_NAME__
      ? String(window.__USER_NAME__)
      : "";

    const propertyStoreMode = typeof window !== "undefined" && window.__PROPERTY_STORE_MODE__
      ? String(window.__PROPERTY_STORE_MODE__)
      : "script";

    const adminSettingsEnabled = typeof window !== "undefined" && window.__ADMIN_SETTINGS_ENABLED__ !== undefined
      ? Boolean(window.__ADMIN_SETTINGS_ENABLED__)
      : true;

    return { isAdmin, formId, authError, userEmail, userName, propertyStoreMode, adminSettingsEnabled };
  }, []);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * 認証情報を取得するフック
 * @returns {{ isAdmin: boolean, formId: string, authError: string, userEmail: string, userName: string, propertyStoreMode: string, adminSettingsEnabled: boolean }}
 */
export function useAuth() {
  return useContext(AuthContext);
}
