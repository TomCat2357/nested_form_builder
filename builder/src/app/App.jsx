import React from "react";
import { HashRouter, Route, Routes, Navigate, useParams, useSearchParams } from "react-router-dom";
import { AppDataProvider } from "./state/AppDataProvider.jsx";
import { AlertProvider } from "./state/AlertProvider.jsx";
import { AuthProvider, useAuth } from "./state/authContext.jsx";
import { ChildFormProvider } from "../features/childform/ChildFormOverlay.jsx";
import { useGlobalUnsyncedGuard } from "./hooks/useGlobalUnsyncedGuard.js";
import HomePage from "../pages/HomePage.jsx";
import SearchPage from "../pages/SearchPage.jsx";
import FormPage from "../pages/FormPage.jsx";
import SettingsPage from "../pages/SettingsPage.jsx";
import FormSettingsPage from "../pages/FormSettingsPage.jsx";
import AdminHubPage from "../pages/AdminHubPage.jsx";
import AdminFormListPage from "../pages/admin/AdminFormListPage.jsx";
import AdminFormEditorPage from "../pages/admin/AdminFormEditorPage.jsx";
import AdminDashboardListPage from "../pages/admin/AdminDashboardListPage.jsx";
import AdminQuestionListPage from "../pages/admin/AdminQuestionListPage.jsx";
import QuestionEditorPage from "../pages/admin/QuestionEditorPage.jsx";
import DashboardEditorPage from "../pages/admin/DashboardEditorPage.jsx";
import DashboardViewPage from "../pages/dashboards/DashboardViewPage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";

/**
 * /admin/forms* 用ラッパー
 * scriptモードは管理者のみ、userモードは全ユーザー許可（旧 FormsRoute と同等）
 */
function FormsRoute({ children }) {
  const { isAdmin, formId, propertyStoreMode } = useAuth();

  if (propertyStoreMode === "user") {
    return children;
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
 * 管理者のみ許可するルートラッパー
 * /admin, /admin/dashboards*, /admin/questions* で使用
 */
function AdminRoute({ children }) {
  const { isAdmin, formId } = useAuth();

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
  const { authError, formId, recordId } = useAuth();

  if (authError === "form_not_found") {
    return <FormNotFoundPage />;
  }
  if (authError === "access_denied" || authError === "forbidden") {
    return <AccessDeniedPage />;
  }

  if (formId && recordId) {
    return <Navigate to={`/form/${formId}/entry/${recordId}`} replace />;
  }

  if (formId) {
    return <Navigate to={`/search?form=${formId}`} replace />;
  }

  return <HomePage />;
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
 * /config?form=xxx → /forms/xxx/settings リダイレクト
 * /config (form なし) → /settings
 */
function LegacyConfigRedirect() {
  const [searchParams] = useSearchParams();
  const formId = (searchParams.get("form") || "").trim();
  if (formId) {
    return <Navigate to={`/forms/${encodeURIComponent(formId)}/settings`} replace />;
  }
  return <Navigate to="/settings" replace />;
}

/**
 * /forms/:formId/edit (旧URL) → /admin/forms/:formId/edit
 */
function LegacyFormEditRedirect() {
  const { formId } = useParams();
  return <Navigate to={`/admin/forms/${formId}/edit`} replace />;
}

/**
 * /analytics → 管理者なら /admin、非管理者なら /?view=dashboards
 */
function LegacyAnalyticsRedirect() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? "/admin" : "/?view=dashboards"} replace />;
}

/**
 * /analytics/dashboards/:id → /dashboards/:id (閲覧)
 */
function LegacyDashboardViewRedirect() {
  const { dashboardId } = useParams();
  return <Navigate to={`/dashboards/${dashboardId}`} replace />;
}

/**
 * /analytics/dashboards/:id/edit → /admin/dashboards/:id/edit
 */
function LegacyDashboardEditRedirect() {
  const { dashboardId } = useParams();
  return <Navigate to={`/admin/dashboards/${dashboardId}/edit`} replace />;
}

/**
 * /analytics/questions/:id → /admin/questions/:id
 */
function LegacyQuestionEditRedirect() {
  const { questionId } = useParams();
  return <Navigate to={`/admin/questions/${questionId}`} replace />;
}

/**
 * ルーティング本体
 */
function AppRoutes() {
  useGlobalUnsyncedGuard();
  return (
    <Routes>
      <Route path="/" element={<UserRedirect />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/form/:formId/new" element={<FormPage />} />
      <Route path="/form/:formId/entry/:entryId" element={<FormPage />} />

      {/* 統合設定 */}
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/forms/:formId/settings" element={<FormSettingsPage />} />

      {/* 管理ハブ */}
      <Route
        path="/admin"
        element={(
          <AdminRoute>
            <AdminHubPage />
          </AdminRoute>
        )}
      />

      {/* フォーム管理（user mode は許可継続） */}
      <Route
        path="/admin/forms"
        element={(
          <FormsRoute>
            <AdminFormListPage />
          </FormsRoute>
        )}
      />
      <Route
        path="/admin/forms/new"
        element={(
          <FormsRoute>
            <AdminFormEditorPage />
          </FormsRoute>
        )}
      />
      <Route
        path="/admin/forms/:formId/edit"
        element={(
          <FormsRoute>
            <AdminFormEditorPage />
          </FormsRoute>
        )}
      />

      {/* ダッシュボード管理 */}
      <Route
        path="/admin/dashboards"
        element={(
          <AdminRoute>
            <AdminDashboardListPage />
          </AdminRoute>
        )}
      />
      <Route
        path="/admin/dashboards/new"
        element={(
          <AdminRoute>
            <DashboardEditorPage />
          </AdminRoute>
        )}
      />
      <Route
        path="/admin/dashboards/:dashboardId/edit"
        element={(
          <AdminRoute>
            <DashboardEditorPage />
          </AdminRoute>
        )}
      />

      {/* Question 管理 */}
      <Route
        path="/admin/questions"
        element={(
          <AdminRoute>
            <AdminQuestionListPage />
          </AdminRoute>
        )}
      />
      <Route
        path="/admin/questions/new"
        element={(
          <AdminRoute>
            <QuestionEditorPage />
          </AdminRoute>
        )}
      />
      <Route
        path="/admin/questions/:questionId"
        element={(
          <AdminRoute>
            <QuestionEditorPage />
          </AdminRoute>
        )}
      />

      {/* ダッシュボード閲覧（誰でも可） */}
      <Route path="/dashboards/:dashboardId" element={<DashboardViewPage />} />

      {/* 旧URL → 新URL リダイレクト */}
      <Route path="/config" element={<LegacyConfigRedirect />} />
      <Route path="/admin-settings" element={<Navigate to="/settings?tab=admin" replace />} />
      <Route path="/forms" element={<Navigate to="/admin/forms" replace />} />
      <Route path="/forms/new" element={<Navigate to="/admin/forms/new" replace />} />
      <Route path="/forms/:formId/edit" element={<LegacyFormEditRedirect />} />
      <Route path="/analytics" element={<LegacyAnalyticsRedirect />} />
      <Route path="/analytics/dashboards/new" element={<Navigate to="/admin/dashboards/new" replace />} />
      <Route path="/analytics/dashboards/:dashboardId/edit" element={<LegacyDashboardEditRedirect />} />
      <Route path="/analytics/dashboards/:dashboardId" element={<LegacyDashboardViewRedirect />} />
      <Route path="/analytics/questions/new" element={<Navigate to="/admin/questions/new" replace />} />
      <Route path="/analytics/questions/:questionId" element={<LegacyQuestionEditRedirect />} />

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
          <ChildFormProvider>
            <HashRouter>
              <AppRoutes />
            </HashRouter>
          </ChildFormProvider>
        </AlertProvider>
      </AppDataProvider>
    </AuthProvider>
  );
}
