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
import { buildExportTableData, buildSearchFileRefs } from "../searchExport.js";
import { joinFieldPath } from "../../../utils/pathCodec.js";

// 対象行 (選択行があればその行、なければフィルタ後の全行) を表示用ビュー行に整形して payload の base を組む。
// childFormsByRow（entries と同順・各行 = 子フォーム合成オブジェクト配列）があれば付加する。
// fileRefsByRow（entries と同順・各行 = fileUpload 参照配列）も非空なら付加する（ファイル/フォルダ URL）。
const buildSearchPayloadBase = (form, outputTargetRows, childFormsByRow) => {
  const entries = Array.isArray(outputTargetRows) ? outputTargetRows.map((row) => row.entry).filter(Boolean) : [];
  const table = buildExportTableData({ form, entries });
  const list = {
    // 質問 (ヘッダー) は階層を "/" で連結した「1 列 = 1 文字列」に統一する
    // (検索カラムの正規パス = traverseSchema の pathSegments と同じ表現)。
    headers: table.columns.map((column) => (Array.isArray(column.segments) ? joinFieldPath(column.segments) : "")),
    rows: table.rows,
    rowCount: table.rows.length,
  };
  if (Array.isArray(childFormsByRow) && childFormsByRow.some((cf) => Array.isArray(cf) && cf.length > 0)) {
    list.childFormsByRow = childFormsByRow;
  }
  const fileRefsByRow = buildSearchFileRefs({ form, entries });
  if (Array.isArray(fileRefsByRow) && fileRefsByRow.some((fr) => Array.isArray(fr) && fr.length > 0)) {
    list.fileRefsByRow = fileRefsByRow;
  }
  return { list };
};

// childFormsByRow（各行 = 子フォーム合成オブジェクト配列）から最初の非空 childSpreadsheetId を拾う。
// 親フォームの formLink は通常 1 つ（choju の従事者情報）なので単一値で足りる。
const firstChildSpreadsheetId = (childFormsByRow) => {
  if (!Array.isArray(childFormsByRow)) return "";
  for (const row of childFormsByRow) {
    if (!Array.isArray(row)) continue;
    for (const obj of row) {
      const id = obj && typeof obj.childSpreadsheetId === "string" ? obj.childSpreadsheetId.trim() : "";
      if (id) return id;
    }
  }
  return "";
};

// 外部アクション送信。送信は本体 GAS のサーバ間リレー（sendExternalAction →
// nfbSendExternalAction → UrlFetchApp）で行い、ブラウザの隠しフォーム POST に伴う
// ログインリダイレクト（POST 本文消失）を避ける。子データは送信時に on-demand 取得する。
// searchChildFormsResolver(entries) は childFormsByRow を返す async 関数。
const handleExternalActionClick = async (action, { formContext, isAdmin, form, outputTargetRows, searchChildFormsResolver }) => {
  const gate = { adminOnly: !!action.adminOnly, isAdmin };
  // URL トークン解決は印刷様式と共通の alasql `{{...}}` エンジンに統一。旧・単括弧固定トークンは
  // 自動マップ。機微予約トークンは adminOnly && isAdmin のときだけ展開を許可（早期失敗を維持）。
  const migratedUrl = migrateLegacyExternalActionUrlTokens(action.url);
  if (hasBlockedSensitiveRefs(extractReservedRefs(migratedUrl), gate)) {
    // eslint-disable-next-line no-alert
    window.alert("この URL には管理者限定のトークンが含まれています。フォーム設定で「管理者のみ」を有効にするか、トークンを見直してください。");
    return;
  }
  if (!hasScriptRun()) {
    // eslint-disable-next-line no-alert
    window.alert("この機能はGoogle Apps Script環境でのみ利用可能です");
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
    // eslint-disable-next-line no-alert
    window.alert("URL が不正です (http:// または https:// で始まる必要があります)。フォーム設定を確認してください。");
    return;
  }
  let childFormsByRow = null;
  if (typeof searchChildFormsResolver === "function") {
    const entries = Array.isArray(outputTargetRows) ? outputTargetRows.map((row) => row.entry).filter(Boolean) : [];
    try {
      childFormsByRow = await searchChildFormsResolver(entries);
    } catch (_e) {
      childFormsByRow = null; // 取得失敗時は子データ無しで送信（無言）。
    }
  }
  // 子フォームのスプレッドシート ID をリレーで動的に受け渡す（admin ゲートは buildExternalActionPayload 側）。
  const childSpreadsheetId = firstChildSpreadsheetId(childFormsByRow);
  const payload = buildExternalActionPayload({
    context: "search",
    formId: formContext?.formId,
    formName: formContext?.formName,
    base: buildSearchPayloadBase(form, outputTargetRows, childFormsByRow),
    storageFields: { ...(formContext || {}), childSpreadsheetId },
    gate,
  });
  try {
    const res = await sendExternalAction({ url: resolvedUrl, payload });
    const result = interpretExternalActionResponse(res);
    if (!result.ok) {
      // eslint-disable-next-line no-alert
      window.alert(result.message || "外部アクションの送信先でエラーが発生しました。");
      return;
    }
    const msg = result.message || "外部アクションを送信しました。";
    if (result.openUrl) {
      // eslint-disable-next-line no-alert
      window.alert(msg + "\n" + result.openUrl);
      try { window.open(result.openUrl, "_blank", "noopener"); } catch (_e2) { /* noop */ }
    } else {
      // eslint-disable-next-line no-alert
      window.alert(msg);
    }
  } catch (error) {
    // 誤送信防止ハンドシェイクで宛先を確認できなかったときは、その理由をそのまま伝える。
    if (error && error.code === "DEST_UNVERIFIED") {
      // eslint-disable-next-line no-alert
      window.alert(error.message || "宛先を確認できませんでした（誤送信防止）。");
      return;
    }
    // eslint-disable-next-line no-alert
    window.alert("外部アクション送信に失敗しました: " + (error && error.message ? error.message : String(error)));
  }
};

const buildExternalActionButtons = (externalActions, formContext, { isAdmin = false, form = null, outputTargetRows = null, searchChildFormsResolver = null } = {}) => {
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
        onClick: () => { handleExternalActionClick(action, { formContext, isAdmin, form, outputTargetRows, searchChildFormsResolver }).catch(() => {}); },
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
  form = null,
  outputTargetRows = null,
  searchChildFormsResolver = null,
}) => {
  const deleteBtn = isUndoDelete
    ? { label: "削除取消し", onClick: onUndelete, disabled: selectedCount === 0 || readOnly, className: "search-sidebar-btn-warning" }
    : { label: "削除", onClick: onDelete, disabled: selectedCount === 0 || readOnly, className: "search-sidebar-btn-danger" };

  const externalButtons = buildExternalActionButtons(externalActions, formContext, { isAdmin, form, outputTargetRows, searchChildFormsResolver });

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
