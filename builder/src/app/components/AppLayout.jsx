import React from "react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useBuilderSettings } from "../../features/settings/settingsStore.js";
import { DEFAULT_THEME, applyThemeWithFallback } from "../theme/theme.js";

export default function AppLayout({ themeOverride, title, fallbackPath = "/", onBack, backHidden = false, actions, sidebarActions, badge, children }) {
  const navigate = useNavigate();
  const { settings } = useBuilderSettings();

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
        <div>{actions}</div>
      </header>
      <div className="app-container">
        {(sidebarActions || backButton) && (
          <aside className="app-sidebar">
            {backButton}
            {sidebarActions}
          </aside>
        )}
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
