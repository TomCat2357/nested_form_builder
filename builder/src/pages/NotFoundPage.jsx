import React from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <AppLayout title="ページが見つかりません" fallbackPath="/" backHidden>
      <p className="nf-text-subtle">指定されたページは存在しません。</p>
      <button type="button" onClick={() => navigate("/")} className="nf-btn-outline">
        メインへ戻る
      </button>
    </AppLayout>
  );
}
