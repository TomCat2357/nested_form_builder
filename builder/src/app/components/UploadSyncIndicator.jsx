import React, { useEffect, useState } from "react";
import {
  uploadSyncState,
  uploadSyncListeners,
  totalPendingUpload,
} from "../../features/search/globalSyncState.js";
import { retryNow } from "../state/uploadWorker.js";
import UploadSyncPanel from "./UploadSyncPanel.jsx";

/**
 * グローバルなアップロード状態インジケーター（AppLayout ヘッダーに常駐）。
 * オフラインファースト保存で IndexedDB に保存済み・Drive へ未アップロードのフォーム/
 * クエスチョン/ダッシュボードがある間、「🔄 同期中」「⚠️ 未アップロード…あり（N件）」を表示し、
 * 失敗時は「再試行」ボタンを出す。レコード（Sheets）同期の SearchToolbar 表示とは別ドメイン。
 */
export default function UploadSyncIndicator() {
  const [, forceRender] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    uploadSyncListeners.add(listener);
    return () => uploadSyncListeners.delete(listener);
  }, []);

  const total = totalPendingUpload();
  const uploading = uploadSyncState.uploading > 0;
  const hasError = !!uploadSyncState.lastError;
  if (total === 0 && !uploading) return null;

  const { form, question, dashboard } = uploadSyncState.pending;
  const breakdown = [
    form ? `フォーム${form}` : null,
    question ? `クエスチョン${question}` : null,
    dashboard ? `ダッシュボード${dashboard}` : null,
  ].filter(Boolean).join("・");

  return (
    <span
      className="app-upload-sync nf-text-12"
      style={{ display: "inline-flex", alignItems: "center" }}
      title={breakdown ? `未アップロード: ${breakdown}` : "未アップロードはありません"}
    >
      {uploading && (
        <span className="nf-text-primary-strong nf-fw-600 nf-ml-6">🔄 同期中</span>
      )}
      {total > 0 && (
        <button
          type="button"
          className="nf-text-warning nf-fw-600 nf-ml-6"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
          onClick={() => setPanelOpen(true)}
          title="クリックで未アップロードの内訳・取り消し"
        >
          ⚠️ 未アップロードのフォーム（クエスチョン・ダッシュボード）あり（{total}件）
        </button>
      )}
      {hasError && (
        <button
          type="button"
          className="nf-btn nf-btn-compact nf-btn-secondary nf-ml-6"
          onClick={() => { void retryNow(); }}
          title="アップロードを再試行"
        >
          再試行
        </button>
      )}
      {panelOpen && <UploadSyncPanel onClose={() => setPanelOpen(false)} />}
    </span>
  );
}
