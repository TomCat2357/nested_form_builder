import React from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <AppLayout title="ページが見つかりません" fallbackPath="/" backHidden>
      <p style={{ color: "#6B7280" }}>指定されたページは存在しません。</p>
      <button type="button" onClick={() => navigate("/")} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer" }}>
        メインへ戻る
      </button>
    </AppLayout>
  );
}
