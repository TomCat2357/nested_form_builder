import React from "react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useBuilderSettings } from "../../features/settings/settingsStore.js";
import { DEFAULT_THEME, applyThemeWithFallback } from "../theme/theme.js";
import UploadSyncIndicator from "./UploadSyncIndicator.jsx";
import { useSidebarCollapsed } from "../hooks/useSidebarCollapsed.js";
import { toggleSidebarCollapsed } from "../state/sidebarCollapseStore.js";

export default function AppLayout({ themeOverride, title, fallbackPath = "/", onBack, backHidden = false, actions, sidebarActions, badge, children }) {
  const navigate = useNavigate();
  const { settings } = useBuilderSettings({ applyGlobalTheme: false });
  const sidebarCollapsed = useSidebarCollapsed();

  useEffect(() => {
    const themeToApply = themeOverride || settings?.theme || DEFAULT_THEME;
    void applyThemeWithFallback(themeToApply, { persist: false });
  }, [themeOverride, settings?.theme]);

  const resolveTarget = (input) => {
    if (!input) return null;
    if (typeof input === "function") return resolveTarget(input());
    if (typeof input === "string") {
      return { to: input, options: { replace: true } };
    }
    if (typeof input === "object") {
      const to = input.to || input.path || input.pathname;
      if (!to) return null;
      const { replace = true, state } = input;
      return { to, options: { replace, state } };
    }
    return null;
  };

  const handleBack = async () => {
    if (onBack) {
      const result = await onBack({ fallbackPath, navigate });
      if (result === false) return;
      const resolved = resolveTarget(result);
      if (resolved) {
        navigate(resolved.to, resolved.options);
        return;
      }
    }
    const fallback = resolveTarget(fallbackPath);
    if (fallback) {
      navigate(fallback.to, fallback.options);
    }
  };

  const backButton = !backHidden && (
    <button type="button" onClick={handleBack} className="app-back-btn">
      <span className="nf-text-14">←</span>
      <span className="nf-ml-4">戻る</span>
    </button>
  );

  const resolvedBadge = typeof badge === "string" ? { label: badge } : badge;

  const hasSidebar = !!(sidebarActions || backButton);

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-left">
          <h1 className="app-header-title">{title}</h1>
          {resolvedBadge?.label && (
            <span className="app-badge" data-variant={resolvedBadge?.variant || "view"}>
              {resolvedBadge.label}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <UploadSyncIndicator />
          {actions}
        </div>
      </header>
      <div className="app-container">
        {hasSidebar && (
          sidebarCollapsed ? (
            <aside className="app-sidebar app-sidebar--collapsed">
              <button
                type="button"
                className="app-sidebar-toggle"
                onClick={toggleSidebarCollapsed}
                title="サイドバーを表示"
                aria-label="サイドバーを表示"
                aria-expanded={false}
              >
                »
              </button>
            </aside>
          ) : (
            <aside className="app-sidebar">
              <button
                type="button"
                className="app-sidebar-toggle"
                onClick={toggleSidebarCollapsed}
                title="サイドバーを隠す"
                aria-label="サイドバーを隠す"
                aria-expanded={true}
              >
                «
              </button>
              {backButton}
              {sidebarActions}
            </aside>
          )
        )}
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
