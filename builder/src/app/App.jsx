import React from "react";
import { HashRouter, Route, Routes, Navigate } from "react-router-dom";
import { AppDataProvider } from "./state/AppDataProvider.jsx";
import { AlertProvider } from "./state/AlertProvider.jsx";
import { AuthProvider, useAuth } from "./state/authContext.jsx";
import MainPage from "../pages/MainPage.jsx";
import SearchPage from "../pages/SearchPage.jsx";
import FormPage from "../pages/FormPage.jsx";
import AdminDashboardPage from "../pages/AdminDashboardPage.jsx";
import AdminFormEditorPage from "../pages/AdminFormEditorPage.jsx";
import AdminSettingsPage from "../pages/AdminSettingsPage.jsx";
import ConfigPage from "../pages/ConfigPage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";

/**
 * フォーム管理ルートのラッパー
 * scriptモードは管理者のみ、userモードは全ユーザー許可
 */
function FormsRoute({ children }) {
  const { isAdmin, formId, propertyStoreMode } = useAuth();

  if (propertyStoreMode === "user") {
    return children;
  }

  if (!isAdmin) {
    // 一般ユーザーは指定フォームの検索画面へリダイレクト
    if (formId) {
      return <Navigate to={`/search?form=${formId}`} replace />;
    }
    // formIdもない場合はアクセス拒否状態としてトップへ戻す
    return <Navigate to="/" replace />;
  }

  return children;
}

/**
 * 管理者設定ルートのラッパー
 * 管理者設定が有効かつ管理者の場合のみ許可
 */
function AdminSettingsRoute({ children }) {
  const { isAdmin, formId, adminSettingsEnabled } = useAuth();

  if (!adminSettingsEnabled) {
    return <Navigate to="/" replace />;
  }

  if (!isAdmin) {
    if (formId) {
      return <Navigate to={`/search?form=${formId}`} replace />;
    }
    return <Navigate to="/" replace />;
  }

  return children;
}

/**
 * フォームが見つからないエラー画面
 */
function FormNotFoundPage() {
  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-left">
          <h1 className="app-header-title">フォームが見つかりません</h1>
        </div>
      </header>
      <div className="app-container">
        <main className="app-main">
          <div className="nf-card">
            <p>指定されたフォームは存在しません。</p>
            <p className="nf-text-muted nf-text-14 nf-mt-8">
              URLが正しいか確認してください。
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * 一般ユーザー用の初期リダイレクト処理
 */
function UserRedirect() {
  const { authError, formId } = useAuth();

  // 認証エラーがある場合
  if (authError === "form_not_found") {
    return <FormNotFoundPage />;
  }
  if (authError === "access_denied") {
    return <AccessDeniedPage />;
  }

  if (formId) {
    return <Navigate to={`/search?form=${formId}`} replace />;
  }

  return <MainPage />;
}

/**
 * アクセス拒否ページ
 */
function AccessDeniedPage() {
  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-left">
          <h1 className="app-header-title">アクセスできません</h1>
        </div>
      </header>
      <div className="app-container">
        <main className="app-main">
          <div className="nf-card">
            <p>このページにアクセスする権限がありません。</p>
            <p className="nf-text-muted nf-text-14 nf-mt-8">
              正しいURLでアクセスしているか確認してください。
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * ルーティング本体
 */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<UserRedirect />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/form/:formId/new" element={<FormPage />} />
      <Route path="/form/:formId/entry/:entryId" element={<FormPage />} />
      <Route
        path="/forms"
        element={
          <FormsRoute>
            <AdminDashboardPage />
          </FormsRoute>
        }
      />
      <Route
        path="/forms/new"
        element={
          <FormsRoute>
            <AdminFormEditorPage />
          </FormsRoute>
        }
      />
      <Route
        path="/forms/:formId/edit"
        element={
          <FormsRoute>
            <AdminFormEditorPage />
          </FormsRoute>
        }
      />
      <Route
        path="/config"
        element={<ConfigPage />}
      />
      <Route
        path="/admin-settings"
        element={(
          <AdminSettingsRoute>
            <AdminSettingsPage />
          </AdminSettingsRoute>
        )}
      />
      <Route path="/not-found" element={<NotFoundPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppDataProvider>
        <AlertProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </AlertProvider>
      </AppDataProvider>
    </AuthProvider>
  );
}
