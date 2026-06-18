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
  getExtActionSecret,
  setExtActionSecret,
  copyStandardFolders,
  exportMapping,
  importMapping,
  getStdFolderRoot,
  ensureStdFolders,
  alignAllStdFolders,
} from "../../services/gasClient.js";
import AdminCopyStructureDialog from "../../pages/admin/AdminCopyStructureDialog.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { questionCache, dashboardCache } from "../../features/analytics/analyticsCache.js";
import { triggerBlobDownload } from "../../utils/fileDownload.js";
import {
  normalizeAdminEmailInput,
  buildMembershipFailMessage,
  formatAlignSummary,
  formatCopyResult,
  formatImportResult,
} from "./adminTabMessages.js";

function AdminSettingRow({ title, description, label, inputValue, placeholder, onInputChange, onSave, loading, saveDisabled, statusContent, inputType = "text" }) {
  return (
    <>
      <div className="nf-settings-group-title nf-mb-6">{title}</div>
      <p className="nf-mb-12 nf-text-12 nf-text-muted">{description}</p>
      <label className="nf-block nf-fw-600 nf-mb-6">{label}</label>
      <div className="nf-row nf-gap-12">
        <input
          className="nf-input nf-flex-1 nf-min-w-0"
          type={inputType}
          autoComplete={inputType === "password" ? "off" : undefined}
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

  const [extActionSecret, setExtActionSecretState] = useState("");
  const [extActionSecretInput, setExtActionSecretInput] = useState("");
  const [extActionSecretLoading, setExtActionSecretLoading] = useState(false);
  const extActionSecretDialog = useConfirmDialog();

  const [restrictToFormOnly, setRestrictToFormOnlyState] = useState(false);
  const [restrictToFormOnlyLoading, setRestrictToFormOnlyLoading] = useState(false);

  // プロジェクトフォルダ診断 / 標準フォルダ作成（作成と同時に全エンティティの整列も実行）
  const [rootInfo, setRootInfo] = useState(null);   // { resolved, rootUrl, rootName, error }
  const [rootUrlInput, setRootUrlInput] = useState("");
  const [ensureLoading, setEnsureLoading] = useState(false);

  // システムごとコピー
  const copyDialog = useConfirmDialog();
  const [copyUrl, setCopyUrl] = useState("");
  const [copyData, setCopyData] = useState(false);
  const [copyExternalActions, setCopyExternalActions] = useState(false);
  const [rebuildMapping, setRebuildMapping] = useState(true);
  const [copyLoading, setCopyLoading] = useState(false);

  // マッピングの管理（エクスポート / インポート）
  const [mappingImportUrl, setMappingImportUrl] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

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
        const [key, email, restrict, extSecret] = await Promise.all([
          getAdminKey(), getAdminEmail(), getRestrictToFormOnly(), getExtActionSecret(),
        ]);
        setAdminKeyState(key);
        setAdminKeyInput(key);
        setAdminEmailState(email);
        setAdminEmailInput(email);
        setRestrictToFormOnlyState(restrict);
        setExtActionSecretState(extSecret);
        setExtActionSecretInput(extSecret);
      } catch (error) {
        console.error("[SettingsAdminTab] load failed", error);
        showAlert(error?.message || "管理者設定の読み込みに失敗しました");
      }
      // プロジェクトフォルダ診断は失敗しても他設定の読み込みを妨げないよう分離して取得。
      try {
        setRootInfo(await getStdFolderRoot());
      } catch (error) {
        console.error("[SettingsAdminTab] getStdFolderRoot failed", error);
        setRootInfo({ resolved: false, error: error?.message || "プロジェクトフォルダの取得に失敗しました" });
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

  const handleSaveExtActionSecret = () => handleSaveSetting({
    apiFunc: async (val) => await setExtActionSecret(val.trim()),
    inputValue: extActionSecretInput,
    setStateValue: setExtActionSecretState,
    setInputValue: setExtActionSecretInput,
    closeDialog: extActionSecretDialog.close,
    setLoading: setExtActionSecretLoading,
    successMsgEmpty: "送信元シークレットを解除しました。外部アクションは誤送信防止プローブなしで送信されます。",
    successMsgFilled: () => "送信元シークレットを更新しました。受信アプリ側の Script Properties（NFB_EXT_ACTION_SECRET）に同じ値を設定してください。",
    errorMsg: "送信元シークレットの保存に失敗しました",
  });

  const extActionSecretConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: extActionSecretDialog.close },
    { value: "save", label: "保存する", variant: "primary", onSelect: handleSaveExtActionSecret },
  ];

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

  // 標準フォルダ構成を作成し、続けて登録済みフォーム・Question・Dashboard を全件整列する
  // （実フォルダ位置 ↔ 登録論理パスを照合し、プロジェクト内は移動・外はコピー取り込み＋参照再リンク）。
  // 対象が無ければ全件 0 件で無害に終わる。冪等。
  const handleEnsureFolders = async () => {
    if (!canManageAdminSettings) return;
    setEnsureLoading(true);
    try {
      const { rootName } = await ensureStdFolders(rootUrlInput.trim());
      const align = await alignAllStdFolders();
      const fresh = await getStdFolderRoot();
      setRootInfo(fresh);
      setRootUrlInput("");

      const message = formatAlignSummary(rootName, align);

      // id 変化（コピー/再採用）や参照張り替えがあれば一覧キャッシュを無効化（陳腐リンク防止）。
      const idsChanged = align.forms.copiedExternal || align.forms.rekeyed
        || align.questions.copiedExternal || align.questions.rekeyed
        || align.dashboards.copiedExternal || align.dashboards.rekeyed
        || align.relinkedFiles;
      if (idsChanged) {
        await invalidateListCaches();
      }
      showAlert(message);
    } catch (error) {
      console.error("[SettingsAdminTab] ensureFolders/align failed", error);
      showAlert(error?.message || "標準フォルダ構成の作成・整理に失敗しました");
    } finally {
      setEnsureLoading(false);
    }
  };

  const handleCopyConfirm = async () => {
    if (!canManageAdminSettings) return;
    setCopyLoading(true);
    try {
      const result = await copyStandardFolders({
        destRootUrl: copyUrl.trim(),
        copyData,
        copyExternalActions,
        rebuildMapping,
      });
      copyDialog.close();
      setCopyUrl("");
      showAlert(formatCopyResult(result));
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
      const result = await importMapping(mappingImportUrl.trim());
      const body = formatImportResult(result);
      await invalidateListCaches();
      showAlert(`マッピングをインポートしました。\n${body}`);
    } catch (error) {
      console.error("[SettingsAdminTab] importMapping failed", error);
      showAlert(error?.message || "マッピングのインポートに失敗しました");
    } finally {
      setImportLoading(false);
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
        <AdminSettingRow
          title="外部アクション 送信元シークレット"
          description={<>外部アクション（検索画面ボタン / レコードの外部アクション）の<strong>誤送信防止ハンドシェイク</strong>用シークレットです。設定すると、データ送信前に宛先が正しい受信アプリかを確認し、一致を確認できない宛先には送信しません。受信アプリ側の Script Properties にキー <code>NFB_EXT_ACTION_SECRET</code> で同じ値を設定してください。空欄にすると誤送信防止は無効になります。</>}
          label="送信元シークレット"
          inputType="password"
          inputValue={extActionSecretInput}
          placeholder="未設定（誤送信防止なし）"
          onInputChange={setExtActionSecretInput}
          onSave={() => extActionSecretDialog.open()}
          loading={extActionSecretLoading}
          saveDisabled={extActionSecretInput.trim() === extActionSecret}
          statusContent={extActionSecret ? "送信元シークレットは設定済みです（誤送信防止が有効）。" : "現在は送信元シークレットが未設定のため、誤送信防止は行われません。"}
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
          親フォルダ（プロジェクトフォルダ）を基点とする標準フォルダ構成（<code>01_forms</code>〜<code>08_documents</code>）に保存されます。
        </p>

        {/* 機能1: いまのプロジェクトフォルダ配下に標準フォルダを用意し、全エンティティを整列する（コピーではない） */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6">① 標準フォルダ構成を作成・整理（このプロジェクトフォルダ配下）</div>

        {rootInfo === null ? (
          <p className="nf-mb-12 nf-text-12 nf-text-muted">現在のプロジェクトフォルダを確認中…</p>
        ) : (
          rootInfo.resolved ? (
            <p className="nf-mb-12 nf-text-12">
              現在のプロジェクトフォルダ:{" "}
              {rootInfo.rootUrl
                ? <a href={rootInfo.rootUrl} target="_blank" rel="noreferrer"><code>{rootInfo.rootName || rootInfo.rootUrl}</code></a>
                : <code>{rootInfo.rootName || "(名称不明)"}</code>}
            </p>
          ) : (
            <p className="nf-mb-12 nf-text-12" style={{ color: "#c0392b" }}>
              プロジェクトフォルダを自動検出できませんでした{rootInfo.error ? `（${rootInfo.error}）` : ""}。
              下の入力欄にプロジェクトフォルダ（appsscript 本体が置かれたフォルダ）の URL を指定してから「標準フォルダ構成を今すぐ作成・整理」を実行してください。
            </p>
          )
        )}

        <div className="nf-row nf-gap-12 nf-mb-6">
          <input
            className="nf-input nf-flex-1 nf-min-w-0"
            type="text"
            value={rootUrlInput}
            placeholder="プロジェクトフォルダの URL（空欄なら自動検出。指定すると手動で固定）"
            onChange={(event) => setRootUrlInput(event.target.value)}
          />
        </div>

        <div className="nf-row nf-gap-12" style={{ flexWrap: "wrap" }}>
          <button type="button" className="nf-btn nf-nowrap" onClick={handleEnsureFolders} disabled={!canManageAdminSettings || ensureLoading}>
            {ensureLoading ? "作成・整理中..." : "標準フォルダ構成を今すぐ作成・整理"}
          </button>
        </div>
        <p className="nf-mt-6 nf-mb-24 nf-text-11 nf-text-muted">
          このプロジェクトフォルダ配下に <code>01_forms</code>〜<code>08_documents</code> を作成します（不足分のみ補完）。
          あわせて、リンク済みのフォーム・Question・Dashboard について、各ファイルの実フォルダ位置を登録済みの論理パスと照合し、ずれていれば整列します。
          <strong>このプロジェクトフォルダ内のファイルは移動</strong>し、<strong>プロジェクト外のファイルは正しい論理フォルダへコピー取り込み</strong>します
          （コピー時は fileId を付け替え、参照リンクも自動で張り直します）。中身の不要な複製は行いません。何度実行しても結果は同じです（冪等）。
        </p>

        {/* 機能2: システム一式を別のプロジェクトフォルダへ複製する */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6">② システムごと別のプロジェクトフォルダへコピー</div>
        <div className="nf-row nf-gap-12" style={{ flexWrap: "wrap" }}>
          <button type="button" className="nf-btn nf-nowrap" onClick={() => copyDialog.open()} disabled={!canManageAdminSettings}>
            システムごと別のプロジェクトフォルダへコピー
          </button>
        </div>
        <p className="nf-mt-6 nf-mb-24 nf-text-11 nf-text-muted">
          appsscript 本体と標準フォルダ構成の中身を<strong>別のプロジェクトフォルダ</strong>へ複製し、フォーム→スプレッドシート等のリンクを
          コピー後の URL で再構成します。コピー先スクリプトの Web アプリは手動で再デプロイしてください。
        </p>

      </div>

      <div className="nf-section-divider">
        <div className="nf-settings-group-title nf-mb-6">マッピングの管理</div>
        <p className="nf-mb-12 nf-text-12 nf-text-muted">
          フォーム・Question・Dashboard の「ID→Drive ファイル対応表（マッピング）」をエクスポート／インポートします。
          システムをコピーした直後の復元は、コピー先プロジェクトフォルダに保存された <code>_nfb_mapping.json</code> を
          「インポート」（URL 空欄）で取り込んでください。取り込んだ資産の物理整列・リンク補完は、
          各エンティティを次に保存した際にサーバ側で自動的に行われます。
        </p>

        {/* 復元（取り込み）: マッピングを「取り込む」復元手段。 */}
        <div className="nf-fw-600 nf-text-13 nf-mb-6">復元（取り込み）</div>
        <label className="nf-block nf-fw-600 nf-mb-6">インポート（JSON から復元）</label>
        <div className="nf-row nf-gap-12">
          <input
            className="nf-input nf-flex-1 nf-min-w-0"
            type="text"
            value={mappingImportUrl}
            placeholder="マッピング JSON の URL（空欄ならコピー先プロジェクトフォルダの最新 .json を読み込み）"
            onChange={(event) => setMappingImportUrl(event.target.value)}
          />
          <button type="button" className="nf-btn nf-nowrap" onClick={handleImportMapping} disabled={!canManageAdminSettings || importLoading}>
            {importLoading ? "インポート中..." : "インポート"}
          </button>
        </div>
        <p className="nf-mt-6 nf-mb-12 nf-text-11 nf-text-muted">
          インポートは既存マッピングへマージします（同じ fileId は重複としてスキップ）。
          取り込んだフォーム・Question・Dashboard は、次回保存時にサーバ側で標準フォルダへ自動整列・再リンクされます。
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
        open={copyDialog.state.open}
        url={copyUrl}
        onUrlChange={setCopyUrl}
        copyData={copyData}
        onCopyDataChange={setCopyData}
        copyExternalActions={copyExternalActions}
        onCopyExternalActionsChange={setCopyExternalActions}
        rebuildMapping={rebuildMapping}
        onRebuildMappingChange={setRebuildMapping}
        onConfirm={handleCopyConfirm}
        onCancel={() => copyDialog.close()}
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
        open={extActionSecretDialog.state.open}
        title="送信元シークレットを変更しますか？"
        message={
          extActionSecretInput.trim()
            ? "外部アクションの送信元シークレットを変更します。受信アプリ側の Script Properties（NFB_EXT_ACTION_SECRET）にも同じ値を設定してください。"
            : "送信元シークレットを解除します。外部アクションは誤送信防止プローブなしで送信されるようになります。"
        }
        options={extActionSecretConfirmOptions}
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
