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
  userAffiliation: "",
  userPhone: "",
  propertyStoreMode: "script",
  adminSettingsEnabled: true,
});

const getWindowGlobal = (key, defaultVal, castFn = (value) => value) => {
  if (typeof window === "undefined") return defaultVal;
  if (window[key] === undefined) return defaultVal;
  return castFn(window[key]);
};

/**
 * 認証プロバイダー
 * window.__IS_ADMIN__ と window.__FORM_ID__ と window.__AUTH_ERROR__ を読み取る
 */
export function AuthProvider({ children }) {
  const value = useMemo(() => {
    // GASから注入されたグローバル変数を読み取る
    // 未定義の場合はデフォルトで管理者モード（開発環境用）
    const isAdmin = getWindowGlobal("__IS_ADMIN__", true, Boolean);
    const formId = getWindowGlobal("__FORM_ID__", "", String);
    const authError = getWindowGlobal("__AUTH_ERROR__", "", String);
    const userEmail = getWindowGlobal("__USER_EMAIL__", "", String);
    const userName = getWindowGlobal("__USER_NAME__", "", String);
    const userAffiliation = getWindowGlobal("__USER_AFFILIATION__", "", String);
    const userPhone = getWindowGlobal("__USER_PHONE__", "", String);
    const propertyStoreMode = getWindowGlobal("__PROPERTY_STORE_MODE__", "script", String);
    const adminSettingsEnabled = getWindowGlobal("__ADMIN_SETTINGS_ENABLED__", true, Boolean);

    return { isAdmin, formId, authError, userEmail, userName, userAffiliation, userPhone, propertyStoreMode, adminSettingsEnabled };
  }, []);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * 認証情報を取得するフック
 * @returns {{ isAdmin: boolean, formId: string, authError: string, userEmail: string, userName: string, userAffiliation: string, userPhone: string, propertyStoreMode: string, adminSettingsEnabled: boolean }}
 */
export function useAuth() {
  return useContext(AuthContext);
}
