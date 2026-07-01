import {
  isValidExternalActionUrl,
  buildSpreadsheetUrl,
  hasBlockedSensitiveRefs,
  migrateLegacyExternalActionUrlTokens,
} from "../../../utils/externalActionUrl.js";
import { buildExternalActionPayload, interpretExternalActionResponse } from "../../../utils/externalActionPost.js";
import { hasScriptRun, sendExternalAction } from "../../../services/gasClient.js";
import { resolveTemplateTokensAsync } from "../../../utils/tokenReplacer.js";
import { extractReservedRefs } from "../../expression/templateEvaluator.js";
import { resolveStyleSettingsInlineStyle } from "../../../core/styleSettings.js";
import { buildRecordFromEntry } from "../../preview/childFormData.js";

// 対象行 (選択行があればその行、なければフィルタ後の全行) を { id, no, items } レコード配列へ整形して
// payload の base を組む。起動元に依らない統一フォーマット（records 配列 + recordCount）で、編集画面
// （PreviewPage）と完全に同形（単一選択なら recordCount:1）。childDataByRow（entries と同順・各行 =
// { fieldId: 子フォーム合成オブジェクト }）があれば、buildRecordFromEntry が formLink 項目を items に
// インライン展開する。fileUpload のファイル/フォルダ URL も items[].files / folderUrl に内包する。
const buildSearchPayloadBase = (normalizedSchema, outputTargetRows, childDataByRow) => {
  const entries = Array.isArray(outputTargetRows) ? outputTargetRows.map((row) => row.entry).filter(Boolean) : [];
  const records = entries.map((entry, i) => buildRecordFromEntry(
    normalizedSchema,
    entry,
    { childDataByFieldId: (childDataByRow && childDataByRow[i]) || undefined },
  ));
  return { records, recordCount: records.length };
};

// storage.childSpreadsheetId / childSheetName（リレーで choju 等へ動的受け渡し）を決める。
// 非管理者（または非 adminOnly ボタン）には子 SS を一切渡さない。通過時は子フォーム定義から直接
// 解決する resolver を使う。これは子レコードの有無に依存しない＝取り込みなど「これから子を作る」
// 操作（既存子が 0 件）でも子 SS を解決できる。子 SS は storage（admin ゲート）にのみ載り、子データ
// 本体 items には含めないため、非管理者へ漏れる経路は無い。
export const resolveChildStorageMeta = async ({ sensitiveAllowed, searchChildStorageMetaResolver }) => {
  if (!sensitiveAllowed || typeof searchChildStorageMetaResolver !== "function") {
    return { childSpreadsheetId: "", childSheetName: "" };
  }
  try {
    const meta = await searchChildStorageMetaResolver();
    return { childSpreadsheetId: (meta && meta.childSpreadsheetId) || "", childSheetName: (meta && meta.childSheetName) || "" };
  } catch (_e) {
    return { childSpreadsheetId: "", childSheetName: "" };
  }
};

// 外部アクション送信。送信は本体 GAS のサーバ間リレー（sendExternalAction →
// nfbSendExternalAction → UrlFetchApp）で行い、ブラウザの隠しフォーム POST に伴う
// ログインリダイレクト（POST 本文消失）を避ける。子データは送信時に on-demand 取得する。
// searchChildFormsResolver(entries) は entries と同順の「各行 = { fieldId: 子フォーム合成オブジェクト }」を返す async 関数。
// searchChildStorageMetaResolver() は子フォーム定義から { childSpreadsheetId, childSheetName } を直接返す async 関数
// （子レコードの有無に依存しない。取り込みなど既存子が無い操作でも子 SS を解決するため）。
const handleExternalActionClick = async (action, { formContext, isAdmin, normalizedSchema, outputTargetRows, searchChildFormsResolver, searchChildStorageMetaResolver, showAlert, showOutputAlert }) => {
  const gate = { adminOnly: !!action.adminOnly, isAdmin };
  // URL トークン解決は印刷様式と共通の alasql `{{...}}` エンジンに統一。旧・単括弧固定トークンは
  // 自動マップ。機微予約トークンは adminOnly && isAdmin のときだけ展開を許可（早期失敗を維持）。
  const migratedUrl = migrateLegacyExternalActionUrlTokens(action.url);
  if (hasBlockedSensitiveRefs(extractReservedRefs(migratedUrl), gate)) {
    showAlert("この URL には管理者限定のトークンが含まれています。フォーム設定で「管理者のみ」を有効にするか、トークンを見直してください。");
    return;
  }
  if (!hasScriptRun()) {
    showAlert("この機能はGoogle Apps Script環境でのみ利用可能です");
    return;
  }
  const sensitiveAllowed = gate.adminOnly && gate.isAdmin;
  const fc = formContext || {};
  const urlCtx = {
    formId: fc.formId || "",
    formName: fc.formName || "",
    valueTransform: encodeURIComponent,
    ...(sensitiveAllowed ? {
      spreadsheetId: fc.spreadsheetId || "",
      spreadsheetUrl: buildSpreadsheetUrl(fc.spreadsheetId || ""),
      sheetName: fc.sheetName || "",
      driveFileUrl: fc.driveFileUrl || "",
      userEmail: fc.userEmail || "",
    } : {}),
  };
  let resolvedUrl = "";
  try {
    resolvedUrl = await resolveTemplateTokensAsync(migratedUrl, urlCtx);
  } catch (_e) {
    resolvedUrl = "";
  }
  if (!isValidExternalActionUrl(resolvedUrl)) {
    showAlert("URL が不正です (http:// または https:// で始まる必要があります)。フォーム設定を確認してください。");
    return;
  }
  let childDataByRow = null;
  if (typeof searchChildFormsResolver === "function") {
    const entries = Array.isArray(outputTargetRows) ? outputTargetRows.map((row) => row.entry).filter(Boolean) : [];
    try {
      childDataByRow = await searchChildFormsResolver(entries);
    } catch (_e) {
      childDataByRow = null; // 取得失敗時は子データ無しで送信（無言）。
    }
  }
  // 子フォームのスプレッドシート ID をリレーで動的に受け渡す（admin ゲートは buildExternalActionPayload 側）。
  // 子 SS は機微情報なので storage（admin ゲート）にのみ載せる。子データ本体は items にインライン
  // 展開され SS を含まないため、非管理者へ子 SS が漏れる経路は無い（旧 stripChildSpreadsheetIds 不要）。
  const { childSpreadsheetId, childSheetName } = await resolveChildStorageMeta({ sensitiveAllowed, searchChildStorageMetaResolver });
  const payload = buildExternalActionPayload({
    formId: formContext?.formId,
    formName: formContext?.formName,
    base: buildSearchPayloadBase(normalizedSchema, outputTargetRows, childDataByRow),
    storageFields: { ...(formContext || {}), childSpreadsheetId, childSheetName },
    gate,
  });
  try {
    const res = await sendExternalAction({ url: resolvedUrl, payload });
    const result = interpretExternalActionResponse(res);
    if (!result.ok) {
      // ok:false でも openUrl があれば右下通知のリンクから開けるようにする（受信側の権限付与誘導に対応）。
      showOutputAlert({
        message: result.message || "外部アクションの送信先でエラーが発生しました。",
        url: result.openUrl || resolvedUrl,
        linkLabel: result.openUrl ? "送信先を開く" : "送信先ページを開く",
      });
      return;
    }
    const msg = result.message || "外部アクションを送信しました。";
    if (result.openUrl) {
      showOutputAlert({ message: msg, url: result.openUrl, linkLabel: "結果を開く" });
    } else if (result.htmlBody) {
      // HTML 応答は権限付与ページへのリダイレクト等の可能性がある。
      showOutputAlert({ message: msg, url: resolvedUrl, linkLabel: "送信先ページを開く" });
    } else {
      showAlert(msg);
    }
  } catch (error) {
    // 誤送信防止ハンドシェイクで宛先を確認できなかったときは、その理由をそのまま伝える。
    if (error && error.code === "DEST_UNVERIFIED") {
      showOutputAlert({ message: error.message || "宛先を確認できませんでした（誤送信防止）。", url: resolvedUrl, linkLabel: "送信先ページを開く" });
    } else {
      showOutputAlert({
        message: "外部アクション送信に失敗しました: " + (error && error.message ? error.message : String(error)),
        url: resolvedUrl,
        linkLabel: "送信先ページを開く",
      });
    }
  }
};

const buildExternalActionButtons = (externalActions, formContext, { isAdmin = false, normalizedSchema = null, outputTargetRows = null, searchChildFormsResolver = null, searchChildStorageMetaResolver = null, showAlert = () => {}, showOutputAlert = () => {} } = {}) => {
  if (!Array.isArray(externalActions) || externalActions.length === 0) return [];
  return externalActions
    .filter((action) => action && typeof action.url === "string" && action.url.trim() !== "")
    .filter((action) => !action.adminOnly || isAdmin)
    .map((action) => {
      const enabled = typeof action.showStyleSettings === "boolean"
        ? action.showStyleSettings
        : !!action.styleSettings;
      const style = enabled ? resolveStyleSettingsInlineStyle(action.styleSettings || {}) : undefined;
      return {
        label: (action.label && action.label.trim()) || "外部アクション",
        onClick: () => { handleExternalActionClick(action, { formContext, isAdmin, normalizedSchema, outputTargetRows, searchChildFormsResolver, searchChildStorageMetaResolver, showAlert, showOutputAlert }).catch(() => {}); },
        title: action.url,
        style: style && Object.keys(style).length > 0 ? style : undefined,
      };
    });
};

export const buildSearchSidebarButtons = ({
  onBack,
  showBack,
  onCreate,
  onConfig,
  onDelete,
  onUndelete,
  onPrint,
  onRefresh,
  onExport,
  useCache,
  refreshBusy,
  refreshDisabled,
  exporting,
  selectedCount,
  filteredCount,
  isUndoDelete,
  printing,
  readOnly = false,
  externalActions = null,
  formContext = null,
  isAdmin = false,
  normalizedSchema = null,
  outputTargetRows = null,
  searchChildFormsResolver = null,
  searchChildStorageMetaResolver = null,
  showAlert = () => {},
  showOutputAlert = () => {},
}) => {
  const deleteBtn = isUndoDelete
    ? { label: "削除取消し", onClick: onUndelete, disabled: selectedCount === 0 || readOnly, className: "search-sidebar-btn-warning" }
    : { label: "削除", onClick: onDelete, disabled: selectedCount === 0 || readOnly, className: "search-sidebar-btn-danger" };

  const externalButtons = buildExternalActionButtons(externalActions, formContext, { isAdmin, normalizedSchema, outputTargetRows, searchChildFormsResolver, searchChildStorageMetaResolver, showAlert, showOutputAlert });

  return [
    showBack && onBack && { label: "← 戻る", onClick: onBack },
    { label: "新規入力", onClick: onCreate, disabled: readOnly, title: readOnly ? "このフォームは参照のみに設定されています" : undefined },
    deleteBtn,
    { label: refreshBusy ? "🔄 更新中..." : "🔄 更新", onClick: onRefresh, disabled: refreshDisabled, className: useCache && !refreshBusy ? "search-sidebar-btn-warning" : "", title: useCache ? "キャッシュから表示中 - クリックで最新データを取得" : "最新データを取得" },
    { label: exporting ? "出力中..." : "検索結果を出力", onClick: onExport, disabled: exporting || filteredCount === 0, title: filteredCount === 0 ? "出力するデータがありません" : `検索結果 ${filteredCount} 件を出力` },
    onPrint && {
      label: printing ? "出力中..." : "印刷様式を出力",
      onClick: onPrint,
      disabled: printing,
      title: selectedCount === 0 ? "出力するレコードを選択してください" : `選択中の${selectedCount}件を印刷様式として出力`,
    },
    onConfig && { label: "設定", onClick: onConfig },
    ...externalButtons,
  ].filter(Boolean);
};
