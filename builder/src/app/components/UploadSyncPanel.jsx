import React, { useCallback, useEffect, useState } from "react";
import BaseDialog from "./BaseDialog.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { isLocalId } from "../../core/ids.js";
import {
  getAllJobs,
  subscribeUploadQueue,
  getJobLabel,
  getJobReason,
} from "../state/uploadQueue.js";
import {
  retryJob,
  retryNow,
  cancelJobKeepLocal,
  cancelJobDiscard,
  cancelAllKeepLocal,
  cancelAllDiscard,
} from "../state/uploadWorker.js";

/**
 * 未アップロード状態パネル。
 * インジケーター（UploadSyncIndicator）クリックで開き、uploadQueue の各ジョブの
 * 種別・名前・状態・「なぜ未送信か」・試行回数を表示する。各行と全体で「再試行」「取り消し」が可能。
 * 取り消しは毎回 2 択（破棄／キューから外すだけ）を確認ダイアログで選ばせる。
 * ジョブ詳細は uploadQueue の pub/sub（subscribeUploadQueue）で最新化する。
 */

const ENTITY_LABEL = { form: "フォーム", question: "クエスチョン", dashboard: "ダッシュボード" };

const entityLabel = (job) => (job.kind === "op" ? "操作" : (ENTITY_LABEL[job.entityType] || job.entityType || "?"));

const statusLabel = (job) => {
  if (Array.isArray(job.dependsOnLocalIds) && job.dependsOnLocalIds.length > 0) return "依存待ち";
  if (job.status === "uploading") return "送信中";
  if (job.status === "error") return "失敗";
  return "待機中";
};

const statusClass = (job) => {
  if (job.status === "error") return "nf-text-warning";
  if (job.status === "uploading") return "nf-text-primary-strong";
  return "";
};

// 既存編集フォームの「破棄」は schema 巻き戻しが初版スコープ外のため不可。
const canDiscard = (job) => job.kind !== "op" && (isLocalId(job.localId) || job.entityType !== "form");
const isUploading = (job) => job.status === "uploading";

export default function UploadSyncPanel({ onClose }) {
  const [jobs, setJobs] = useState([]);
  const [confirm, setConfirm] = useState(null); // null | { scope: "single"|"all", job? }

  const reload = useCallback(async () => {
    const all = await getAllJobs();
    all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    setJobs(all);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => { void reload().catch(() => { if (alive) setJobs([]); }); };
    run();
    const unsubscribe = subscribeUploadQueue(() => { if (alive) run(); });
    return () => { alive = false; unsubscribe(); };
  }, [reload]);

  const jobsById = new Map(jobs.filter((j) => j.localId).map((j) => [j.localId, j]));

  const closeConfirm = useCallback(() => setConfirm(null), []);

  const doKeepLocal = useCallback(async () => {
    const target = confirm;
    setConfirm(null);
    if (!target) return;
    if (target.scope === "all") await cancelAllKeepLocal();
    else if (target.job) await cancelJobKeepLocal(target.job.jobId);
  }, [confirm]);

  const doDiscard = useCallback(async () => {
    const target = confirm;
    setConfirm(null);
    if (!target) return;
    if (target.scope === "all") await cancelAllDiscard();
    else if (target.job) await cancelJobDiscard(target.job);
  }, [confirm]);

  const confirmOptions = () => {
    if (!confirm) return [];
    const allowDiscard = confirm.scope === "all" || (confirm.job && canDiscard(confirm.job));
    const opts = [];
    if (allowDiscard) {
      opts.push({ value: "discard", label: "破棄（ローカルも巻き戻す）", variant: "danger", onSelect: () => { void doDiscard(); } });
    }
    opts.push({ value: "keep", label: "キューから外すだけ", variant: "primary", onSelect: () => { void doKeepLocal(); } });
    opts.push({ value: "cancel", label: "やめる", variant: "", onSelect: closeConfirm });
    return opts;
  };

  const confirmMessage = () => {
    if (!confirm) return "";
    if (confirm.scope === "all") {
      return `未アップロード ${jobs.length} 件すべての取り消し方法を選んでください。`
        + "「破棄」は新規をローカルから削除し、既存のクエスチョン/ダッシュボードはサーバ最新版に戻します"
        + "（既存フォームはキューからの除去のみ）。";
    }
    const job = confirm.job;
    const base = `「${getJobLabel(job)}」の未アップロードを取り消します。`;
    if (job && !canDiscard(job)) {
      return base + "このフォームは「破棄」非対応のため、キューからの除去のみ行えます。";
    }
    return base + "「破棄」は手元の未送信内容も巻き戻します。";
  };

  const footer = (
    <>
      <button
        type="button"
        className="dialog-btn"
        onClick={() => { void retryNow(); }}
        disabled={jobs.length === 0}
        title="失敗したジョブのバックオフを解除して全部やり直す"
      >
        すべて再試行
      </button>
      <button
        type="button"
        className="dialog-btn danger"
        onClick={() => setConfirm({ scope: "all" })}
        disabled={jobs.length === 0}
      >
        すべて取り消し
      </button>
      <button type="button" className="dialog-btn primary" onClick={onClose}>
        閉じる
      </button>
    </>
  );

  return (
    <>
      <BaseDialog open title={`未アップロード（${jobs.length}件）`} footer={footer}>
        {jobs.length === 0 ? (
          <p className="dialog-message">未アップロードはありません。</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "50vh", overflowY: "auto" }}>
            {jobs.map((job) => (
              <div
                key={job.jobId}
                style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "8px 10px", border: "1px solid var(--nf-border, #ddd)", borderRadius: "6px",
                }}
              >
                <span className="nf-text-12" style={{ flex: "0 0 90px", fontWeight: 600 }}>
                  {entityLabel(job)}
                </span>
                <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {getJobLabel(job)}
                  </span>
                  <span className={`nf-text-12 ${statusClass(job)}`} style={{ display: "block" }}>
                    {statusLabel(job)}
                    {job.attempt ? `・試行${job.attempt}回` : ""}
                    {" — "}
                    {getJobReason(job, jobsById)}
                  </span>
                </span>
                <button
                  type="button"
                  className="nf-btn nf-btn-compact nf-btn-secondary"
                  onClick={() => { void retryJob(job.jobId); }}
                  disabled={isUploading(job) || job.status !== "error"}
                  title={job.status === "error" ? "このジョブを今すぐ再試行" : "失敗状態のときだけ再試行できます"}
                >
                  再試行
                </button>
                <button
                  type="button"
                  className="nf-btn nf-btn-compact nf-btn-secondary"
                  onClick={() => setConfirm({ scope: "single", job })}
                  disabled={isUploading(job)}
                  title={isUploading(job) ? "送信中は取り消せません" : "このジョブを取り消す"}
                >
                  取り消し
                </button>
              </div>
            ))}
          </div>
        )}
      </BaseDialog>

      <ConfirmDialog
        open={!!confirm}
        title="未アップロードの取り消し"
        message={confirmMessage()}
        options={confirmOptions()}
      />
    </>
  );
}
