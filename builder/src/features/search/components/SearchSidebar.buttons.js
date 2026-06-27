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
import { openInNewTab } from "../../../utils/openWindow.js";

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

// 子フォームの保存先 spreadsheetId / sheetName は機微情報。storage と異なり list.childFormsByRow
// は常時送信されるため、admin ゲート未通過のときはここで明示的に剥がす（漏洩防止）。
export const stripChildSpreadsheetIds = (childFormsByRow) => {
  if (!Array.isArray(childFormsByRow)) return childFormsByRow;
  return childFormsByRow.map((row) => (
    Array.isArray(row)
      ? row.map((obj) => {
        if (!obj || typeof obj !== "object") return obj;
        if (!("childSpreadsheetId" in obj) && !("childSheetName" in obj)) return obj;
        const copy = { ...obj };
        delete copy.childSpreadsheetId;
        delete copy.childSheetName;
        return copy;
      })
      : row
  ));
};

// childFormsByRow（各行 = 子フォーム合成オブジェクト配列）から最初の非空 childSpreadsheetId を持つ
// 子フォームの { childSpreadsheetId, childSheetName } を拾う。親フォームの formLink は通常 1 つ
// （choju の従事者情報）なので単一値で足りる。
const firstChildStorageMeta = (childFormsByRow) => {
  if (!Array.isArray(childFormsByRow)) return { childSpreadsheetId: "", childSheetName: "" };
  for (const row of childFormsByRow) {
    if (!Array.isArray(row)) continue;
    for (const obj of row) {
      const id = obj && typeof obj.childSpreadsheetId === "string" ? obj.childSpreadsheetId.trim() : "";
      if (id) {
        const sheet = obj && typeof obj.childSheetName === "string" ? obj.childSheetName : "";
        return { childSpreadsheetId: id, childSheetName: sheet };
      }
    }
  }
  return { childSpreadsheetId: "", childSheetName: "" };
};

// storage.childSpreadsheetId / childSheetName（リレーで choju 等へ動的受け渡し）を決める。
// 非管理者（または非 adminOnly ボタン）には子 SS を一切渡さない。
// 通過時はまず子フォーム定義から直接解決する resolver を優先する。これは子レコードの有無に依存しない
// ＝取り込みなど「これから子を作る」操作（既存子が 0 件）でも子 SS を解決できる（本不具合の修正点）。
// resolver 未提供/失敗/空のときだけ、既存子データ childFormsByRow から拾う（後方互換のフォールバック）。
export const resolveChildStorageMeta = async ({ sensitiveAllowed, searchChildStorageMetaResolver, childFormsByRow }) => {
  if (!sensitiveAllowed) return { childSpreadsheetId: "", childSheetName: "" };
  let meta = { childSpreadsheetId: "", childSheetName: "" };
  if (typeof searchChildStorageMetaResolver === "function") {
    try { meta = await searchChildStorageMetaResolver(); }
    catch (_e) { meta = { childSpreadsheetId: "", childSheetName: "" }; }
  }
  if (!meta || !meta.childSpreadsheetId) meta = firstChildStorageMeta(childFormsByRow);
  return { childSpreadsheetId: (meta && meta.childSpreadsheetId) || "", childSheetName: (meta && meta.childSheetName) || "" };
};

// 外部アクション送信。送信は本体 GAS のサーバ間リレー（sendExternalAction →
// nfbSendExternalAction → UrlFetchApp）で行い、ブラウザの隠しフォーム POST に伴う
// ログインリダイレクト（POST 本文消失）を避ける。子データは送信時に on-demand 取得する。
// searchChildFormsResolver(entries) は childFormsByRow を返す async 関数。
// searchChildStorageMetaResolver() は子フォーム定義から { childSpreadsheetId, childSheetName } を直接返す async 関数
// （子レコードの有無に依存しない。取り込みなど既存子が無い操作でも子 SS を解決するため）。
const handleExternalActionClick = async (action, { formContext, isAdmin, form, outputTargetRows, searchChildFormsResolver, searchChildStorageMetaResolver }) => {
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
  // storage だけでなく常時送信の list.childFormsByRow からも非管理者には剥がす（base 経由の漏洩を塞ぐ）。
  const { childSpreadsheetId, childSheetName } = await resolveChildStorageMeta({ sensitiveAllowed, searchChildStorageMetaResolver, childFormsByRow });
  const baseChildFormsByRow = sensitiveAllowed ? childFormsByRow : stripChildSpreadsheetIds(childFormsByRow);
  const payload = buildExternalActionPayload({
    context: "search",
    formId: formContext?.formId,
    formName: formContext?.formName,
    base: buildSearchPayloadBase(form, outputTargetRows, baseChildFormsByRow),
    storageFields: { ...(formContext || {}), childSpreadsheetId, childSheetName },
    gate,
  });
  try {
    const res = await sendExternalAction({ url: resolvedUrl, payload });
    const result = interpretExternalActionResponse(res);
    if (!result.ok) {
      // ok:false でも openUrl があれば新タブで開く（受信側の権限付与誘導に対応）。
      const openTarget = result.openUrl || resolvedUrl;
      // eslint-disable-next-line no-alert
      window.alert(result.message || "外部アクションの送信先でエラーが発生しました。");
      openInNewTab(openTarget);
      return;
    }
    const msg = result.message || "外部アクションを送信しました。";
    if (result.openUrl) {
      // eslint-disable-next-line no-alert
      window.alert(msg + "\n" + result.openUrl);
      openInNewTab(result.openUrl);
    } else if (result.htmlBody) {
      // HTML 応答は権限付与ページへのリダイレクト等の可能性がある。
      // eslint-disable-next-line no-alert
      window.alert(msg);
      openInNewTab(resolvedUrl);
    } else {
      // eslint-disable-next-line no-alert
      window.alert(msg);
    }
  } catch (error) {
    // 誤送信防止ハンドシェイクで宛先を確認できなかったときは、その理由をそのまま伝える。
    if (error && error.code === "DEST_UNVERIFIED") {
      // eslint-disable-next-line no-alert
      window.alert(error.message || "宛先を確認できませんでした（誤送信防止）。");
    } else {
      // eslint-disable-next-line no-alert
      window.alert("外部アクション送信に失敗しました: " + (error && error.message ? error.message : String(error)));
    }
    openInNewTab(resolvedUrl);
  }
};

const buildExternalActionButtons = (externalActions, formContext, { isAdmin = false, form = null, outputTargetRows = null, searchChildFormsResolver = null, searchChildStorageMetaResolver = null } = {}) => {
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
        onClick: () => { handleExternalActionClick(action, { formContext, isAdmin, form, outputTargetRows, searchChildFormsResolver, searchChildStorageMetaResolver }).catch(() => {}); },
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
  searchChildStorageMetaResolver = null,
}) => {
  const deleteBtn = isUndoDelete
    ? { label: "削除取消し", onClick: onUndelete, disabled: selectedCount === 0 || readOnly, className: "search-sidebar-btn-warning" }
    : { label: "削除", onClick: onDelete, disabled: selectedCount === 0 || readOnly, className: "search-sidebar-btn-danger" };

  const externalButtons = buildExternalActionButtons(externalActions, formContext, { isAdmin, form, outputTargetRows, searchChildFormsResolver, searchChildStorageMetaResolver });

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
