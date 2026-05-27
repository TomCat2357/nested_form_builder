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

// 既リンク資産のうち標準フォルダ構成外だったものを構成内へコピーした件数を文面にする。
// total が 0（コピー発生なし）のときは空配列を返し、従来文面のままにする。
function buildNormalizedLines(normalized) {
  if (!normalized || !normalized.total) return [];
  return [
    "",
    "標準フォルダ構成外だったため標準フォルダへコピーしました:",
    `フォーム: ${normalized.forms?.count || 0}件 / Question: ${normalized.questions?.count || 0}件 / Dashboard: ${normalized.dashboards?.count || 0}件`,
    `（うちダッシュボード連動でコピーした Question: ${normalized.cascadedQuestions || 0}件）`,
  ];
}

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

  const [restrictToFormOnly, setRestrictToFormOnlyState] = useState(false);
  const [restrictToFormOnlyLoading, setRestrictToFormOnlyLoading] = useState(false);

  // ルートフォルダ診断 / 標準フォルダ作成
  const [rootInfo, setRootInfo] = useState(null);   // { resolved, rootUrl, rootName, error }
  const [rootUrlInput, setRootUrlInput] = useState("");
  const [ensureLoading, setEnsureLoading] = useState(false);

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

  const handleEnsureFolders = async () => {
    if (!canManageAdminSettings) return;
    setEnsureLoading(true);
    try {
      const { rootName } = await ensureStdFolders(rootUrlInput.trim());
      const fresh = await getStdFolderRoot();
      setRootInfo(fresh);
      setRootUrlInput("");
      showAlert(`「${rootName}」配下に標準フォルダ構成（01_forms〜08_documents）を作成しました。`);
    } catch (error) {
      console.error("[SettingsAdminTab] ensureStdFolders failed", error);
      showAlert(error?.message || "標準フォルダ構成の作成に失敗しました");
    } finally {
      setEnsureLoading(false);
    }
  };

  const handleCopyConfirm = async () => {
    if (!canManageAdminSettings) return;
    setCopyLoading(true);
    try {
      const { summary, clearedLinks, appsScriptCopied, message } = await copyStandardFolders({
        destRootUrl: copyUrl.trim(),
        copyData,
        copyWebhooks,
        rebuildMapping,
      });
      const lines = Object.keys(summary).map((k) => `${k}: ${summary[k]}件`);
      setCopyDialogOpen(false);
      setCopyUrl("");
      showAlert(
        `${message}\n\nappsscript 本体: ${appsScriptCopied ? "コピーしました" : "コピーできませんでした（権限等を確認してください）"}\n` +
        `コピー件数:\n${lines.join("\n")}\nクリアしたリンク: ${clearedLinks}`,
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
      const { imported, skipped, errors, normalized } = await importMapping(mappingImportUrl.trim());
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
      lines.push(...buildNormalizedLines(normalized));
      await invalidateListCaches();
      showAlert(`マッピングをインポートしました。\n${lines.join("\n")}`);
    } catch (error) {
      console.error("[SettingsAdminTab] importMapping failed", error);
      showAlert(error?.message || "マッピングのインポートに失敗しました");
    } finally {
      setImportLoading(false);
    }
  };

  const handleSyncMapping = async () => {
    if (!canManageAdminSettings) return;
    setSyncLoading(true);
    try {
      const { forms, questions, dashboards, normalized } = await rebuildMappingsFromFolders("");
      await invalidateListCaches();
      const lines = [
        `フォーム: ${forms.count || 0}件`,
        `Question: ${questions.count || 0}件`,
        `Dashboard: ${dashboards.count || 0}件`,
      ];
      lines.push(...buildNormalizedLines(normalized));
      showAlert("フォルダ走査で未リンクのファイルをリンクしました。\n" + lines.join("\n"));
    } catch (error) {
      console.error("[SettingsAdminTab] rebuildMappingsFromFolders failed", error);
      showAlert(error?.message || "マッピングの同期に失敗しました");
    } finally {
      setSyncLoading(false);
    }
  };

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
        <div className="nf-settings-group-title nf-mb-6">システムごとコピー</div>
        <p className="nf-mb-12 nf-text-12 nf-text-muted">
          フォーム・Question・Dashboard・スプレッドシート・アップロードファイルは、appsscript 本体が置かれた
          親フォルダをルートとする標準フォルダ構成（<code>01_forms</code>〜<code>08_documents</code>）に保存されます。
          いずれかを保存すると、不足しているフォルダも含めて全て自動作成されます。
        </p>

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

        <div className="nf-row nf-gap-12 nf-mb-12">
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
          <button type="button" className="nf-btn nf-nowrap" onClick={() => setCopyDialogOpen(true)} disabled={!canManageAdminSettings}>
            システムごとコピー
          </button>
        </div>
        <p className="nf-mt-6 nf-text-11 nf-text-muted">
          appsscript 本体と標準フォルダ構成の中身を別ルートへ複製し、フォーム→スプレッドシート等のリンクを
          コピー後の URL で再構成します。コピー先スクリプトの Web アプリは手動で再デプロイしてください。
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
          JSON が無い場合は、フォルダを走査して未リンクのファイルをマッピングへ復元します。
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
    </div>
  );
}
