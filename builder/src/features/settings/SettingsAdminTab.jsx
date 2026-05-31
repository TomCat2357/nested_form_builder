import React, { useEffect, useMemo, useState } from "react";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import {
  hasScriptRun,
  getAdminKey,
  setAdminKey,
  getAdminEmail,
  setAdminEmail,
  checkAdminEmailMembership,
  getRestrictToFormOnly,
  setRestrictToFormOnly,
  copyStandardFolders,
  exportMapping,
  importMapping,
  rebuildMappingsFromFolders,
  getStdFolderRoot,
  ensureStdFolders,
  backfillPhysicalFolders,
  buildLinkReport,
  relinkReferences,
  dedupeForms,
} from "../../services/gasClient.js";
import AdminCopyStructureDialog from "../../pages/admin/AdminCopyStructureDialog.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { questionCache, dashboardCache } from "../../features/analytics/analyticsCache.js";
import { triggerBlobDownload } from "../../utils/fileDownload.js";

const normalizeAdminEmailInput = (value) => String(value || "")
  .split(";")
  .map((item) => item.trim())
  .filter(Boolean)
  .join(";");

// 既リンク資産のうち標準フォルダ構成外だったものを構成内へコピーした件数と、
function buildMembershipFailMessage({ userEmail, reason, groupErrors, detail }) {
  const safeUser = userEmail || "不明";
  if (reason === "missing_current_user_email") {
    return "現在ユーザーのメールアドレスを取得できませんでした。Google アカウントにログインし直してから再度お試しください。";
  }
  if (reason === "group_fetch_failed") {
    const entries = Object.entries(groupErrors || {});
    const lines = entries.length
      ? entries.map(([group, message]) => `・${group}: ${message}`).join("\n")
      : "（詳細不明）";
    return (
      `現在のアカウント（${safeUser}）が管理者メンバーであるか確認できませんでした。\n` +
      `以下のグループのメンバー取得に失敗しました:\n${lines}\n\n` +
      `権限不足・外部グループ・削除済みグループの可能性があります。\n` +
      `回避策: 自分のメールアドレスを管理者リストに直接追加してから保存してください。`
    );
  }
  if (reason === "not_member") {
    return (
      `現在のアカウント（${safeUser}）が管理者リストに含まれていません。\n` +
      `自分自身をロックアウトしないよう、現在のメールアドレスまたは所属グループをリストに含めてください。`
    );
  }
  return detail || `管理者リストの検証に失敗しました（${reason || "unknown"}）。`;
}

function AdminSettingRow({ title, description, label, inputValue, placeholder, onInputChange, onSave, loading, saveDisabled, statusContent }) {
  return (
    <>
      <div className="nf-settings-group-title nf-mb-6">{title}</div>
      <p className="nf-mb-12 nf-text-12 nf-text-muted">{description}</p>
      <label className="nf-block nf-fw-600 nf-mb-6">{label}</label>
      <div className="nf-row nf-gap-12">
        <input
          className="nf-input nf-flex-1 nf-min-w-0"
          type="text"
          value={inputValue}
          placeholder={placeholder}
          onChange={(event) => onInputChange(event.target.value)}
        />
        <button
          type="button"
          className="nf-btn nf-nowrap"
          onClick={onSave}
          disabled={loading || saveDisabled}
        >
          {loading ? "保存中..." : "保存"}
        </button>
      </div>
      <p className="nf-mt-6 nf-text-11 nf-text-muted">{statusContent}</p>
    </>
  );
}

export default function SettingsAdminTab() {
  const { showAlert } = useAlert();

  const [adminKey, setAdminKeyState] = useState("");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminKeyLoading, setAdminKeyLoading] = useState(false);
  const adminKeyDialog = useConfirmDialog();

  const [adminEmail, setAdminEmailState] = useState("");
  const [adminEmailInput, setAdminEmailInput] = useState("");
  const [adminEmailLoading, setAdminEmailLoading] = useState(false);
  const adminEmailDialog = useConfirmDialog();

  // 同名フォーム重複整理の適用前確認（ゴミ箱移動を伴う破壊的操作）。
  const dedupeConfirm = useConfirmDialog();

  // 同期（フォルダ走査）の ⑥ 不正ファイル削除の適用前確認（ゴミ箱移動を伴う破壊的操作）。
  const pruneConfirm = useConfirmDialog();
  const [pendingInvalid, setPendingInvalid] = useState([]); // ⑥ 候補（確認ダイアログ表示用）

  const [restrictToFormOnly, setRestrictToFormOnlyState] = useState(false);
  const [restrictToFormOnlyLoading, setRestrictToFormOnlyLoading] = useState(false);

  // ルートフォルダ診断 / 標準フォルダ作成（作成と同時に仮想→物理フォルダ反映も実行）
  const [rootInfo, setRootInfo] = useState(null);   // { resolved, rootUrl, rootName, error }
  const [rootUrlInput, setRootUrlInput] = useState("");
  const [ensureLoading, setEnsureLoading] = useState(false);

  // 構成レポート（リンク診断）
  const [reportLoading, setReportLoading] = useState(false);
  const [reportIncludeJson, setReportIncludeJson] = useState(false);
  const [reportIncludeWebhook, setReportIncludeWebhook] = useState(false);

  // 参照の再リンク / 同名フォーム重複整理
  const [relinkLoading, setRelinkLoading] = useState(false);
  const [dedupeLoading, setDedupeLoading] = useState(false);

  // システムごとコピー
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyUrl, setCopyUrl] = useState("");
  const [copyData, setCopyData] = useState(false);
  const [copyWebhooks, setCopyWebhooks] = useState(false);
  const [rebuildMapping, setRebuildMapping] = useState(true);
  const [copyLoading, setCopyLoading] = useState(false);

  // マッピングの管理（エクスポート / インポート / 同期）
  const [mappingImportUrl, setMappingImportUrl] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  const { refreshForms } = useAppData();
  const { userEmail } = useAuth();
  const canManageAdminSettings = hasScriptRun();
  const normalizedAdminEmailInput = useMemo(
    () => normalizeAdminEmailInput(adminEmailInput),
    [adminEmailInput],
  );

  useEffect(() => {
    if (!canManageAdminSettings) return;
    (async () => {
      try {
        const [key, email, restrict] = await Promise.all([
          getAdminKey(), getAdminEmail(), getRestrictToFormOnly(),
        ]);
        setAdminKeyState(key);
        setAdminKeyInput(key);
        setAdminEmailState(email);
        setAdminEmailInput(email);
        setRestrictToFormOnlyState(restrict);
      } catch (error) {
        console.error("[SettingsAdminTab] load failed", error);
        showAlert(error?.message || "管理者設定の読み込みに失敗しました");
      }
      // ルートフォルダ診断は失敗しても他設定の読み込みを妨げないよう分離して取得。
      try {
        setRootInfo(await getStdFolderRoot());
      } catch (error) {
        console.error("[SettingsAdminTab] getStdFolderRoot failed", error);
        setRootInfo({ resolved: false, error: error?.message || "ルートフォルダの取得に失敗しました" });
      }
    })();
  }, [canManageAdminSettings, showAlert]);

  const handleSaveSetting = async ({ apiFunc, inputValue, setStateValue, setInputValue, closeDialog, setLoading, successMsgEmpty, successMsgFilled, errorMsg }) => {
    if (!canManageAdminSettings) return;
    closeDialog();
    setLoading(true);
    try {
      const newVal = await apiFunc(inputValue);
      setStateValue(newVal);
      setInputValue(newVal);
      showAlert(newVal === "" ? successMsgEmpty : successMsgFilled(newVal));
    } catch (error) {
      console.error(error);
      showAlert(error?.message || errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAdminKey = () => handleSaveSetting({
    apiFunc: async (val) => await setAdminKey(val.trim()),
    inputValue: adminKeyInput,
    setStateValue: setAdminKeyState,
    setInputValue: setAdminKeyInput,
    closeDialog: adminKeyDialog.close,
    setLoading: setAdminKeyLoading,
    successMsgEmpty: "管理者キーを解除しました。URLパラメータなしで管理者としてアクセスできます。",
    successMsgFilled: (val) => `管理者キーを更新しました。次回から ?adminkey=${val} でアクセスしてください。`,
    errorMsg: "管理者キーの保存に失敗しました",
  });

  const handleSaveAdminEmail = async () => {
    if (!canManageAdminSettings) return;
    adminEmailDialog.close();
    setAdminEmailLoading(true);
    try {
      const newVal = await setAdminEmail(normalizedAdminEmailInput);
      setAdminEmailState(newVal);
      setAdminEmailInput(newVal);
      showAlert(newVal === "" ? "管理者メール制限を解除しました。メールアドレスによる管理者制限は行いません。" : "管理者メールを更新しました。設定済みメールと一致しないユーザーは管理者画面へアクセスできません。");
    } catch (error) {
      console.error(error);
      const serverResult = error?.result;
      if (serverResult?.reason) {
        showAlert(buildMembershipFailMessage({
          userEmail: (userEmail || "").trim().toLowerCase(),
          reason: serverResult.reason,
          groupErrors: serverResult.groupErrors,
          detail: serverResult.detail,
        }));
      } else {
        showAlert(error?.message || "管理者メールの保存に失敗しました");
      }
    } finally {
      setAdminEmailLoading(false);
    }
  };

  const adminKeyConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: adminKeyDialog.close },
    { value: "save", label: "保存する", variant: "primary", onSelect: handleSaveAdminKey },
  ];

  const handleOpenAdminEmailConfirm = async () => {
    if (normalizedAdminEmailInput) {
      const emails = normalizedAdminEmailInput.split(";").map((e) => e.trim().toLowerCase()).filter(Boolean);
      const currentEmail = (userEmail || "").trim().toLowerCase();
      if (!currentEmail || !emails.includes(currentEmail)) {
        try {
          const check = await checkAdminEmailMembership({
            userEmail: currentEmail,
            adminEmails: normalizedAdminEmailInput,
          });
          if (!check.isMember) {
            showAlert(buildMembershipFailMessage({
              userEmail: currentEmail,
              reason: check.reason,
              groupErrors: check.groupErrors,
              detail: check.detail,
            }));
            return;
          }
        } catch (error) {
          console.error("[SettingsAdminTab] membership check failed", error);
        }
      }
    }
    adminEmailDialog.open();
  };

  const adminEmailConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: adminEmailDialog.close },
    { value: "save", label: "保存する", variant: "primary", onSelect: handleSaveAdminEmail },
  ];

  const handleToggleRestrictToFormOnly = async (event) => {
    if (!canManageAdminSettings) return;
    const newValue = event.target.checked;
    setRestrictToFormOnlyLoading(true);
    try {
      const saved = await setRestrictToFormOnly(newValue);
      setRestrictToFormOnlyState(saved);
    } catch (error) {
      console.error("[SettingsAdminTab] setRestrictToFormOnly failed", error);
      showAlert(error?.message || "設定の保存に失敗しました");
    } finally {
      setRestrictToFormOnlyLoading(false);
    }
  };

  // 標準フォルダ構成を作成し、続けて仮想フォルダを物理フォルダへ反映する（一連の「整える」操作）。
  // フォームが無ければ反映は 0 件で無害に終わる。冪等。
  const handleEnsureFolders = async () => {
    if (!canManageAdminSettings) return;
    setEnsureLoading(true);
    try {
      const { rootName } = await ensureStdFolders(rootUrlInput.trim());
      const backfill = await backfillPhysicalFolders();
      const fresh = await getStdFolderRoot();
      setRootInfo(fresh);
      setRootUrlInput("");
      const lines = [`「${rootName}」配下に標準フォルダ構成（01_forms〜08_documents）を作成しました。`];
      if (backfill.skipped) {
        lines.push(`仮想フォルダの物理反映はスキップしました（${backfill.reason || "標準フォルダが無効です"}）。`);
      } else {
        lines.push(`仮想フォルダ→物理フォルダ反映: フォルダ ${backfill.folders}件 / 移動 ${backfill.movedFiles}件`);
      }
      showAlert(lines.join("\n"));
    } catch (error) {
      console.error("[SettingsAdminTab] ensureStdFolders failed", error);
      showAlert(error?.message || "標準フォルダ構成の作成に失敗しました");
    } finally {
      setEnsureLoading(false);
    }
  };

  const handleBuildReport = async () => {
    if (!canManageAdminSettings) return;
    setReportLoading(true);
    try {
      const { markdown } = await buildLinkReport({
        includeEntityJson: reportIncludeJson,
        includeWebhookText: reportIncludeWebhook,
      });
      triggerBlobDownload(
        new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        "nfb-structure-report.md",
      );
    } catch (error) {
      console.error("[SettingsAdminTab] buildLinkReport failed", error);
      showAlert(error?.message || "レポートの作成に失敗しました");
    } finally {
      setReportLoading(false);
    }
  };

  const summarizeRelink = (r) => {
    const q = r.questions || {};
    const d = r.dashboards || {};
    const lines = [
      `モード: ${r.mode === "apply" ? "適用（JSON を書換え）" : "プレビュー（未変更）"}`,
      `Question: 走査 ${q.scanned || 0} / 再リンク参照 ${q.refsRelinked || 0}（対象ファイル ${q.filesChanged || 0}）/ 同名曖昧 ${(q.ambiguous || []).length} / 未解決 ${(q.unresolved || []).length}`,
      `Dashboard: 走査 ${d.scanned || 0} / 再リンク参照 ${d.refsRelinked || 0}（対象ファイル ${d.filesChanged || 0}）/ 同名曖昧 ${(d.ambiguous || []).length} / 未解決 ${(d.unresolved || []).length}`,
    ];
    const amb = [...(q.ambiguous || []), ...(d.ambiguous || [])];
    if (amb.length) {
      lines.push(`同名複数で曖昧（手動で再リンク要）: ${amb.slice(0, 8).map((a) => `${a.entity}→${a.id}`).join(" / ")}${amb.length > 8 ? " ほか" : ""}`);
    }
    if (r.truncated) lines.push("⚠ 実行時間の安全弁で打ち切りました。再実行してください。");
    return lines.join("\n");
  };

  const handleRelink = async (mode) => {
    if (!canManageAdminSettings) return;
    setRelinkLoading(true);
    try {
      const r = await relinkReferences({ mode });
      if (mode === "apply") await invalidateListCaches();
      showAlert(summarizeRelink(r));
    } catch (error) {
      console.error("[SettingsAdminTab] relinkReferences failed", error);
      showAlert(error?.message || "参照の再リンクに失敗しました");
    } finally {
      setRelinkLoading(false);
    }
  };

  const summarizeDedupe = (r) => {
    const lines = [
      `モード: ${r.mode === "apply" ? "適用（参照付替え＋重複をゴミ箱へ）" : "プレビュー（未変更）"}`,
      `同名重複グループ: ${(r.duplicateGroups || []).length} / 重複ファイル: ${r.duplicateFileCount || 0}`,
      `参照付替え: ${(r.remap && r.remap.refsRemapped) || 0} 件（Question ${(r.remap && r.remap.filesChanged) || 0} ファイル）`,
    ];
    if (r.mode === "apply") lines.push(`ゴミ箱へ移動: ${(r.trashed || []).length} ファイル`);
    (r.duplicateGroups || []).slice(0, 8).forEach((g) => {
      lines.push(`・「${g.name}」: canonical=${g.canonicalPath}（${g.reason}）/ 重複 ${g.duplicates.length}`);
    });
    if ((r.duplicateGroups || []).length > 8) lines.push("…ほか");
    if (r.truncated) lines.push("⚠ 実行時間の安全弁で打ち切りました。再実行してください。");
    return lines.join("\n");
  };

  const runDedupe = async (mode) => {
    setDedupeLoading(true);
    try {
      const r = await dedupeForms({ mode });
      if (mode === "apply") await invalidateListCaches();
      showAlert(summarizeDedupe(r));
    } catch (error) {
      console.error("[SettingsAdminTab] dedupeForms failed", error);
      showAlert(error?.message || "重複フォームの整理に失敗しました");
    } finally {
      setDedupeLoading(false);
    }
  };

  const handleDedupe = async (mode) => {
    if (!canManageAdminSettings) return;
    if (mode === "apply") { dedupeConfirm.open(); return; }
    await runDedupe("dryRun");
  };

  const dedupeConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: dedupeConfirm.close },
    { value: "apply", label: "適用する（重複をゴミ箱へ）", variant: "primary", onSelect: async () => { dedupeConfirm.close(); await runDedupe("apply"); } },
  ];

  const handleCopyConfirm = async () => {
    if (!canManageAdminSettings) return;
    setCopyLoading(true);
    try {
      const { summary, clearedLinks, unresolvedQuestionLinks, appsScriptCopied, appsScriptCopyError, message } = await copyStandardFolders({
        destRootUrl: copyUrl.trim(),
        copyData,
        copyWebhooks,
        rebuildMapping,
      });
      const lines = Object.keys(summary).map((k) => `${k}: ${summary[k]}件`);
      setCopyDialogOpen(false);
      setCopyUrl("");
      const appsScriptStatus = appsScriptCopied
        ? "コピーしました"
        : `コピーできませんでした（${appsScriptCopyError || "権限等を確認してください"}）`;
      showAlert(
        `${message}\n\nappsscript 本体: ${appsScriptStatus}\n` +
        `コピー件数:\n${lines.join("\n")}\nクリアしたリンク: ${clearedLinks}\n` +
        `未解決の Question リンク（参照は保持・要再リンク）: ${unresolvedQuestionLinks ?? 0}`,
      );
    } catch (error) {
      console.error("[SettingsAdminTab] copyStandardFolders failed", error);
      showAlert(error?.message || "システムごとコピーに失敗しました");
    } finally {
      setCopyLoading(false);
    }
  };

  // マッピング変更後に一覧キャッシュを無効化する（AppDataProvider と同手順）。
  const invalidateListCaches = async () => {
    await refreshForms({ reason: "mapping-changed", background: false });
    try {
      await Promise.all([questionCache.saveAll([]), dashboardCache.saveAll([])]);
    } catch (cacheErr) {
      console.warn("[SettingsAdminTab] analytics cache invalidate failed:", cacheErr);
    }
  };

  const handleExportMapping = async () => {
    if (!canManageAdminSettings) return;
    setExportLoading(true);
    try {
      const doc = await exportMapping();
      triggerBlobDownload(
        new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
        "nfb-mapping.json",
      );
    } catch (error) {
      console.error("[SettingsAdminTab] exportMapping failed", error);
      showAlert(error?.message || "マッピングのエクスポートに失敗しました");
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportMapping = async () => {
    if (!canManageAdminSettings) return;
    setImportLoading(true);
    try {
      const { imported, skipped, errors } = await importMapping(mappingImportUrl.trim());
      const lines = [
        `フォーム: ${imported.forms || 0}件`,
        `Question: ${imported.questions || 0}件`,
        `Dashboard: ${imported.dashboards || 0}件`,
        `スキップ（重複）: ${skipped || 0}件`,
      ];
      if (errors && errors.length) {
        lines.push(`エラー: ${errors.length}件`);
        errors.slice(0, 3).forEach((e) => lines.push(`・[${e.section}] ${e.id}: ${e.reason}`));
        if (errors.length > 3) lines.push(`…ほか ${errors.length - 3}件`);
      }
      // インポートはマッピングのマージのみ。物理整列・リンク修復は「同期（フォルダ走査）」が担うため案内する。
      lines.push("", "続けて「同期（フォルダ走査）」を実行すると、取り込んだ資産を標準フォルダへ整列します。");
      await invalidateListCaches();
      showAlert(`マッピングをインポートしました。\n${lines.join("\n")}`);
    } catch (error) {
      console.error("[SettingsAdminTab] importMapping failed", error);
      showAlert(error?.message || "マッピングのインポートに失敗しました");
    } finally {
      setImportLoading(false);
    }
  };

  // 整合同期の結果（6 ケース）を人間可読にまとめる。
  const summarizeAlign = (r) => {
    const sum = (key) => ["forms", "questions", "dashboards"].reduce((acc, k) => acc + ((r.align?.[k]?.[key]) || 0), 0);
    const reg = (k) => (r.orphans?.[k]?.registered) || 0;
    const lines = [
      `① 一致(変更なし): ${sum("aligned")}件 / ② 物理移動: ${sum("moved")}件 / ② 外部コピー取込: ${sum("copiedExternal")}件 / ③ id再採用: ${sum("rekeyed")}件`,
      `⑤ 新規登録: フォーム ${reg("forms")} / Question ${reg("questions")} / Dashboard ${reg("dashboards")}`,
    ];
    if (r.relink && (r.relink.questions || r.relink.dashboards)) {
      const q = r.relink.questions || {};
      const d = r.relink.dashboards || {};
      lines.push(`参照の自動再リンク: Question ${q.refsRelinked || 0} / Dashboard ${d.refsRelinked || 0} 参照`);
    }
    const errs = r.errors || [];
    if (errs.length) {
      lines.push(`④ 要対応エラー（物理ファイル未検出・自動修復不可）: ${errs.length}件`);
      errs.slice(0, 8).forEach((e) => lines.push(`・[${e.kind}] ${e.name || e.id}（${e.folder || "(直下)"}）: ${e.reason}`));
      if (errs.length > 8) lines.push("…ほか");
    }
    const inv = r.invalidCandidates || [];
    if (inv.length) {
      lines.push(`⑥ 論理に結びつかない不正ファイル: ${inv.length}件（${r.mode === "apply" ? "ゴミ箱へ移動済み" : "未削除"}）`);
    }
    if (r.truncated) lines.push("⚠ 実行時間の安全弁で打ち切りました。再実行してください。");
    return lines.join("\n");
  };

  // 同期本体。applyDelete=true で ⑥ 不正ファイルをゴミ箱へ。サマリ文字列を返す。
  const runSync = async (applyDelete) => {
    const r = await rebuildMappingsFromFolders("", { applyDelete });
    await invalidateListCaches();
    return { r, summary: "フォルダ走査で論理↔物理を整合しました。\n" + summarizeAlign(r) };
  };

  const handleSyncMapping = async () => {
    if (!canManageAdminSettings) return;
    setSyncLoading(true);
    try {
      // フェーズ1: ①〜⑤ を適用し、⑥（不正ファイル）は候補収集のみ。
      const { r, summary } = await runSync(false);
      const invalid = r.invalidCandidates || [];
      if (invalid.length > 0) {
        // ⑥ がある → 削除可否をポップアップで確認（破壊的操作）。
        setPendingInvalid(invalid);
        pruneConfirm.open();
      } else {
        showAlert(summary);
      }
    } catch (error) {
      console.error("[SettingsAdminTab] rebuildMappingsFromFolders failed", error);
      showAlert(error?.message || "マッピングの同期に失敗しました");
    } finally {
      setSyncLoading(false);
    }
  };

  // ⑥ 確認: 「削除する」→ applyDelete:true で再走査してゴミ箱へ。「キャンセル」→ そのまま残す。
  const pruneConfirmOptions = [
    { value: "keep", label: "残す（削除しない）", onSelect: async () => {
      pruneConfirm.close();
      setSyncLoading(true);
      try { const { summary } = await runSync(false); showAlert(summary); }
      catch (error) { showAlert(error?.message || "マッピングの同期に失敗しました"); }
      finally { setSyncLoading(false); setPendingInvalid([]); }
    } },
    { value: "delete", label: "削除する（ゴミ箱へ）", variant: "primary", onSelect: async () => {
      pruneConfirm.close();
      setSyncLoading(true);
      try { const { summary } = await runSync(true); showAlert(summary); }
      catch (error) { showAlert(error?.message || "不正ファイルの削除に失敗しました"); }
      finally { setSyncLoading(false); setPendingInvalid([]); }
    } },
  ];

  return (
    <div className="nf-card">
      {!canManageAdminSettings && (
        <div className="nf-mb-12 nf-text-12 nf-text-muted">
          この機能はGoogle Apps Script環境でのみ利用可能です。
        </div>
      )}

      <AdminSettingRow
        title="管理者キー"
        description={<>管理者キーを設定すると、URLパラメータ <code>?adminkey=キー</code> でアクセスした場合のみ管理者として認識されます。空欄にすると管理者キー制限は解除されます。</>}
        label="管理者キー"
        inputValue={adminKeyInput}
        placeholder="未設定（管理者キー制限なし）"
        onInputChange={setAdminKeyInput}
        onSave={() => adminKeyDialog.open()}
        loading={adminKeyLoading}
        saveDisabled={adminKeyInput.trim() === adminKey}
        statusContent={adminKey ? (<>現在の管理者アクセスURL: <code>?adminkey={adminKey}</code></>) : "現在は管理者キーが未設定のため、管理者キー制限はありません。"}
      />

      <div className="nf-section-divider">
        <AdminSettingRow
          title="管理者メール"
          description={<>複数指定する場合は <code>;</code> 区切りで入力してください。Google グループのメールアドレスも指定できます（グループのメンバー全員が管理者として認識されます）。例: <code>admin1@example.com;admin-group@googlegroups.com</code></>}
          label="管理者メールアドレス"
          inputValue={adminEmailInput}
          placeholder="未設定（メール制限なし）"
          onInputChange={setAdminEmailInput}
          onSave={handleOpenAdminEmailConfirm}
          loading={adminEmailLoading}
          saveDisabled={normalizedAdminEmailInput === adminEmail}
          statusContent={adminEmail ? (<>現在の管理者メール: <code>{adminEmail}</code></>) : "現在は管理者メールが未設定のため、メールアドレスによる管理者制限はありません。"}
        />
      </div>

      <div className="nf-section-divider">
        <div className="nf-settings-group-title nf-mb-6">アクセス制限</div>
        <p className="nf-mb-12 nf-text-12 nf-text-muted">
          管理者キーまたは管理者メールが設定されている場合に有効です。ONにすると、<code>?form=xxx</code> を指定しない一般ユーザーはアクセス拒否されます。
        </p>
        <label className="nf-row nf-gap-8" style={{ alignItems: "center", cursor: restrictToFormOnlyLoading ? "default" : "pointer" }}>
          <input
            type="checkbox"
            checked={restrictToFormOnly}
            disabled={!canManageAdminSettings || restrictToFormOnlyLoading}
            onChange={handleToggleRestrictToFormOnly}
          />
          <span className="nf-text-13">
            一般ユーザーが行ける範囲を個別フォームのみとする
          </span>
          {restrictToFormOnlyLoading && <span className="nf-text-12 nf-text-muted">保存中...</span>}
        </label>
      </div>

      <div className="nf-section-divider">
        <div className="nf-settings-group-title nf-mb-6">フォルダ構成 / システムコピー</div>
        <p className="nf-mb-12 nf-text-12 nf-text-muted">
          フォーム・Question・Dashboard・スプレッドシート・アップロードファイルは、appsscript 本体が置かれた
          親フォルダをルートとする標準フォルダ構成（<code>01_forms</code>〜<code>08_documents</code>）に保存されます。
        </p>

        {/* 機能1: いまのルート配下に標準フォルダを用意するだけ（コピーではない） */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6">① 標準フォルダ構成を作成（このルート配下）</div>

        {rootInfo === null ? (
          <p className="nf-mb-12 nf-text-12 nf-text-muted">現在のルートフォルダを確認中…</p>
        ) : (
          rootInfo.resolved ? (
            <p className="nf-mb-12 nf-text-12">
              現在のルートフォルダ:{" "}
              {rootInfo.rootUrl
                ? <a href={rootInfo.rootUrl} target="_blank" rel="noreferrer"><code>{rootInfo.rootName || rootInfo.rootUrl}</code></a>
                : <code>{rootInfo.rootName || "(名称不明)"}</code>}
            </p>
          ) : (
            <p className="nf-mb-12 nf-text-12" style={{ color: "#c0392b" }}>
              ルートフォルダを自動検出できませんでした{rootInfo.error ? `（${rootInfo.error}）` : ""}。
              下の入力欄にルートフォルダの URL を指定してから「標準フォルダ構成を今すぐ作成」を実行してください。
            </p>
          )
        )}

        <div className="nf-row nf-gap-12 nf-mb-6">
          <input
            className="nf-input nf-flex-1 nf-min-w-0"
            type="text"
            value={rootUrlInput}
            placeholder="ルートフォルダの URL（空欄なら自動検出。指定すると手動ルートとして固定）"
            onChange={(event) => setRootUrlInput(event.target.value)}
          />
        </div>

        <div className="nf-row nf-gap-12" style={{ flexWrap: "wrap" }}>
          <button type="button" className="nf-btn nf-nowrap" onClick={handleEnsureFolders} disabled={!canManageAdminSettings || ensureLoading}>
            {ensureLoading ? "作成中..." : "標準フォルダ構成を今すぐ作成"}
          </button>
        </div>
        <p className="nf-mt-6 nf-mb-24 nf-text-11 nf-text-muted">
          このルート配下に <code>01_forms</code>〜<code>08_documents</code> を作成します（不足分のみ補完）。中身の複製は行いません。
          作成と同時に、これまで <code>01_forms</code> 直下にフラット保存されていたフォームを、仮想フォルダと同じ階層の
          物理フォルダ（<code>01_forms/フォルダ名/…</code>）へ移動して反映します（移行用・冪等。フォームが無ければ作成のみ）。
        </p>

        {/* 機能2: システム一式を別ルートへ複製する */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6">② システムごと別ルートへコピー</div>
        <div className="nf-row nf-gap-12" style={{ flexWrap: "wrap" }}>
          <button type="button" className="nf-btn nf-nowrap" onClick={() => setCopyDialogOpen(true)} disabled={!canManageAdminSettings}>
            システムごと別ルートへコピー
          </button>
        </div>
        <p className="nf-mt-6 nf-mb-24 nf-text-11 nf-text-muted">
          appsscript 本体と標準フォルダ構成の中身を<strong>別のルート</strong>へ複製し、フォーム→スプレッドシート等のリンクを
          コピー後の URL で再構成します。コピー先スクリプトの Web アプリは手動で再デプロイしてください。
        </p>

        {/* 機能3: 構成の中身とリンク関係をレポート化（LLM へのリンク切れ診断用） */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6">③ 構成レポート（リンク診断）</div>
        <p className="nf-mb-12 nf-text-12 nf-text-muted">
          標準フォルダ構成内（子フォルダ含む）にどんなファイルがあり、どのファイルが何をリンクしているかを
          Markdown レポートとして書き出します。リンク切れの診断を LLM に依頼する用途を想定しています。
        </p>
        <label className="nf-row nf-gap-8 nf-mb-6" style={{ alignItems: "center", cursor: reportLoading ? "default" : "pointer" }}>
          <input
            type="checkbox"
            checked={reportIncludeJson}
            disabled={!canManageAdminSettings || reportLoading}
            onChange={(event) => setReportIncludeJson(event.target.checked)}
          />
          <span className="nf-text-13">フォーム・Question・Dashboard の JSON を含める</span>
        </label>
        <label className="nf-row nf-gap-8 nf-mb-12" style={{ alignItems: "center", cursor: reportLoading ? "default" : "pointer" }}>
          <input
            type="checkbox"
            checked={reportIncludeWebhook}
            disabled={!canManageAdminSettings || reportLoading}
            onChange={(event) => setReportIncludeWebhook(event.target.checked)}
          />
          <span className="nf-text-13">Webhook（埋め込み設定＋<code>07_webhooks</code> のファイル）をテキストで含める</span>
        </label>
        <div className="nf-row nf-gap-12" style={{ flexWrap: "wrap" }}>
          <button type="button" className="nf-btn nf-nowrap" onClick={handleBuildReport} disabled={!canManageAdminSettings || reportLoading}>
            {reportLoading ? "作成中..." : "レポートを作成（ダウンロード）"}
          </button>
        </div>
        <p className="nf-mt-6 nf-text-11 nf-text-muted">
          <code>nfb-structure-report.md</code> をダウンロードします。リンク切れ判定は標準フォルダ構成内の照合に加え、
          実行時リゾルバと同じ名前フォールバックも評価します（外部リンクの生死は未検査）。
          フォーム数が多いと GAS の実行時間（6 分）に注意してください。
        </p>

        {/* 機能4: リンク修復（旧 id 参照の恒久再リンク / 同名フォーム重複整理） */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6 nf-mt-24">④ リンク修復（再リンク / 重複整理）</div>
        <p className="nf-mb-12 nf-text-12 nf-text-muted">
          旧 ID のままになっている Question→Form / Dashboard→Question 参照を、現在の fileId へ恒久的に書き換えます。
          まず<strong>プレビュー</strong>で変更予定を確認してから<strong>適用</strong>してください。
          推奨順: 「マッピングの管理 ＞ 同期」→「重複整理（適用）」→「参照を再リンク（適用）」。
        </p>
        <div className="nf-row nf-gap-12 nf-mb-6" style={{ flexWrap: "wrap" }}>
          <button type="button" className="nf-btn nf-nowrap" onClick={() => handleRelink("dryRun")} disabled={!canManageAdminSettings || relinkLoading}>
            {relinkLoading ? "処理中..." : "参照を再リンク（プレビュー）"}
          </button>
          <button type="button" className="nf-btn nf-nowrap" onClick={() => handleRelink("apply")} disabled={!canManageAdminSettings || relinkLoading}>
            {relinkLoading ? "処理中..." : "参照を再リンク（適用）"}
          </button>
        </div>
        <div className="nf-row nf-gap-12" style={{ flexWrap: "wrap" }}>
          <button type="button" className="nf-btn nf-nowrap" onClick={() => handleDedupe("dryRun")} disabled={!canManageAdminSettings || dedupeLoading}>
            {dedupeLoading ? "処理中..." : "同名フォーム重複整理（プレビュー）"}
          </button>
          <button type="button" className="nf-btn nf-nowrap" onClick={() => handleDedupe("apply")} disabled={!canManageAdminSettings || dedupeLoading}>
            {dedupeLoading ? "処理中..." : "同名フォーム重複整理（適用）"}
          </button>
        </div>
        <p className="nf-mt-6 nf-text-11 nf-text-muted">
          再リンクは非破壊（id を現 fileId へ書き換えるのみ）。重複整理は同名グループの canonical を 1 つ残し、
          参照を寄せたうえで残りを Drive のゴミ箱へ移動します（30 日間は復元可）。同名複数で曖昧なものは変更されず、手動対応として報告されます。
        </p>
      </div>

      <div className="nf-section-divider">
        <div className="nf-settings-group-title nf-mb-6">マッピングの管理</div>
        <p className="nf-mb-12 nf-text-12 nf-text-muted">
          フォーム・Question・Dashboard の「ID→Drive ファイル対応表（マッピング）」をエクスポート／インポートします。
          システムをコピーした直後の復元は、コピー先ルートに保存された <code>_nfb_mapping.json</code> を
          「インポート」（URL 空欄）で取り込むか、「同期」でフォルダを走査して復元してください。
        </p>

        {/* 復元（取り込み）: インポートと同期はどちらもマッピングを「取り込む」復元手段。 */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6">復元（取り込み）</div>
        <label className="nf-block nf-fw-600 nf-mb-6">インポート（JSON から復元）</label>
        <div className="nf-row nf-gap-12">
          <input
            className="nf-input nf-flex-1 nf-min-w-0"
            type="text"
            value={mappingImportUrl}
            placeholder="マッピング JSON の URL（空欄ならコピー先ルートの最新 .json を読み込み）"
            onChange={(event) => setMappingImportUrl(event.target.value)}
          />
          <button type="button" className="nf-btn nf-nowrap" onClick={handleImportMapping} disabled={!canManageAdminSettings || importLoading}>
            {importLoading ? "インポート中..." : "インポート"}
          </button>
        </div>
        <p className="nf-mt-6 nf-mb-12 nf-text-11 nf-text-muted">
          インポートは既存マッピングへマージします（同じ fileId は重複としてスキップ）。
        </p>

        <div className="nf-row nf-gap-12">
          <button type="button" className="nf-btn nf-nowrap" onClick={handleSyncMapping} disabled={!canManageAdminSettings || syncLoading}>
            {syncLoading ? "同期中..." : "同期（フォルダ走査）"}
          </button>
        </div>
        <p className="nf-mt-6 nf-text-11 nf-text-muted">
          論理（登録簿）を正として物理 Drive を整合します：①一致は変更なし、②物理位置のズレは移動（プロジェクト外は取り込みコピー）、
          ③同名で id が変わったファイルは id を再採用、④物理が見つからないものはエラー表示、⑤正しい場所の未登録ファイルは新規登録、
          ⑥論理に結びつかない不正ファイルはポップアップ確認のうえゴミ箱へ。
          ⑥の削除確認が出るため、単体の「未追跡ファイル削除」操作は通常不要です。
        </p>

        {/* バックアップ（書き出し）: エクスポートだけが向きの異なる「書き出し」操作。 */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6 nf-mt-24">バックアップ（書き出し）</div>
        <div className="nf-row nf-gap-12">
          <button type="button" className="nf-btn nf-nowrap" onClick={handleExportMapping} disabled={!canManageAdminSettings || exportLoading}>
            {exportLoading ? "エクスポート中..." : "エクスポート（ダウンロード）"}
          </button>
        </div>
        <p className="nf-mt-6 nf-text-11 nf-text-muted">
          現在のマッピングを JSON ファイルとしてダウンロードします。
        </p>
      </div>

      <AdminCopyStructureDialog
        open={copyDialogOpen}
        url={copyUrl}
        onUrlChange={setCopyUrl}
        copyData={copyData}
        onCopyDataChange={setCopyData}
        copyWebhooks={copyWebhooks}
        onCopyWebhooksChange={setCopyWebhooks}
        rebuildMapping={rebuildMapping}
        onRebuildMappingChange={setRebuildMapping}
        onConfirm={handleCopyConfirm}
        onCancel={() => setCopyDialogOpen(false)}
        loading={copyLoading}
      />

      <ConfirmDialog
        open={adminKeyDialog.state.open}
        title="管理者キーを変更しますか？"
        message={
          adminKeyInput.trim()
            ? `管理者キーを「${adminKeyInput.trim()}」に変更します。変更後は ?adminkey=${adminKeyInput.trim()} でアクセスしてください。`
            : "管理者キーを解除します。URLパラメータなしで管理者としてアクセスできるようになります。"
        }
        options={adminKeyConfirmOptions}
      />

      <ConfirmDialog
        open={adminEmailDialog.state.open}
        title="管理者メールを変更しますか？"
        message={
          normalizedAdminEmailInput
            ? `管理者メールを「${normalizedAdminEmailInput}」に変更します。設定されたメール以外は管理者画面へアクセスできなくなります。`
            : "管理者メール制限を解除します。メールアドレスによる管理者制限は行われません。"
        }
        options={adminEmailConfirmOptions}
      />

      <ConfirmDialog
        open={dedupeConfirm.state.open}
        title="同名フォームの重複を整理しますか？"
        message={"同名フォームグループごとに canonical を 1 つ残し、Question の参照を canonical へ付け替えたうえで、残りの重複ファイルを Drive のゴミ箱へ移動します（30 日間は復元可）。まずプレビューで内容を確認することを推奨します。"}
        options={dedupeConfirmOptions}
      />

      <ConfirmDialog
        open={pruneConfirm.state.open}
        title="論理に結びつかない不正ファイルを削除しますか？"
        message={
          `標準フォルダ（01_forms / 02_questions / 03_dashboards）内に、論理（登録簿）と結びつかない不正なファイルが ${pendingInvalid.length} 件見つかりました。` +
          "「削除する」を選ぶと Drive のゴミ箱へ移動します（30 日間は復元可）。\n\n" +
          pendingInvalid.slice(0, 12).map((f) => `・[${f.kind}] ${f.relPath}`).join("\n") +
          (pendingInvalid.length > 12 ? `\n…ほか ${pendingInvalid.length - 12} 件` : "")
        }
        options={pruneConfirmOptions}
      />
    </div>
  );
}
