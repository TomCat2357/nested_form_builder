import React from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { theme } from "../app/theme/tokens.js";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <AppLayout title="ページが見つかりません" fallbackPath="/" backHidden>
      <p style={{ color: theme.textSubtle }}>指定されたページは存在しません。</p>
      <button type="button" onClick={() => navigate("/")} style={{ padding: "8px 14px", borderRadius: theme.radiusSm, border: `1px solid ${theme.borderStrong}`, background: theme.surface, cursor: "pointer" }}>
        メインへ戻る
      </button>
    </AppLayout>
  );
}
