import React from "react";
import { useNavigate } from "react-router-dom";

const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: "1px solid #E5E7EB",
  background: "#F9FAFB",
};

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #CBD5E1",
  background: "#fff",
  cursor: "pointer",
};

const sidebarStyle = {
  width: 200,
  background: "#fff",
  borderRight: "1px solid #E5E7EB",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const mainContentStyle = {
  flex: 1,
  padding: "24px 16px",
  overflowY: "auto",
};

const containerStyle = {
  display: "flex",
  height: "calc(100vh - 49px)",
};

const badgeStyle = {
  fontSize: 11,
  padding: "4px 8px",
  borderRadius: 6,
  background: "#DBEAFE",
  color: "#1E40AF",
  fontWeight: 600,
  marginLeft: 8,
};

const badgeThemes = {
  view: {
    background: "#DBEAFE",
    color: "#1E40AF",
  },
  edit: {
    background: "#FEF3C7",
    color: "#92400E",
  },
  loading: {
    background: "#BFDBFE",
    color: "#1E3A8A",
  },
};

export default function AppLayout({ title, fallbackPath = "/", onBack, backHidden = false, actions, sidebarActions, badge, children }) {
  const navigate = useNavigate();

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
    <button type="button" onClick={handleBack} style={{ ...buttonStyle, width: "100%", textAlign: "left" }}>
      <span style={{ fontSize: 14 }}>←</span>
      <span style={{ marginLeft: 4 }}>戻る</span>
    </button>
  );

  const resolvedBadge = typeof badge === "string" ? { label: badge } : badge;
  const badgeVariantStyle = resolvedBadge?.variant ? badgeThemes[resolvedBadge.variant] || {} : {};
  const finalBadgeStyle = { ...badgeStyle, ...(resolvedBadge?.style || {}), ...badgeVariantStyle };

  return (
    <div style={{ minHeight: "100vh", background: "#F3F4F6" }}>
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>{title}</h1>
          {resolvedBadge?.label && <span style={finalBadgeStyle}>{resolvedBadge.label}</span>}
        </div>
        <div>{actions}</div>
      </header>
      <div style={containerStyle}>
        {(sidebarActions || backButton) && (
          <aside style={sidebarStyle}>
            {backButton}
            {sidebarActions}
          </aside>
        )}
        <main style={mainContentStyle}>{children}</main>
      </div>
    </div>
  );
}
