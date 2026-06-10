import { resolveExternalActionUrl } from "../../../utils/externalActionUrl.js";
import { submitExternalActionPost, buildExternalActionPayload, openExternalActionWindow } from "../../../utils/externalActionPost.js";
import { resolveStyleSettingsInlineStyle } from "../../../core/styleSettings.js";
import { buildExportTableData } from "../searchExport.js";
import { joinFieldPath } from "../../../utils/pathCodec.js";

// 対象行 (選択行があればその行、なければフィルタ後の全行) を表示用ビュー行に整形して payload の base を組む。
// childFormsByRow（entries と同順・各行 = 子フォーム合成オブジェクト配列）があれば付加する。
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
  return { list };
};

// 外部アクション（Webhook）送信。子データは「送信時のみ」on-demand 取得する方針のため、
// クリック時点で結果タブを同期 open（ポップアップブロック回避）してから子データを await 取得し、
// その既存タブへ POST する。searchChildFormsResolver(entries) は childFormsByRow を返す async 関数。
const handleExternalActionClick = async (action, { formContext, isAdmin, form, outputTargetRows, searchChildFormsResolver }) => {
  const gate = { adminOnly: !!action.adminOnly, isAdmin };
  // 既存設定の URL トークン置換は後方互換のため維持 (機微トークンの gating も従来通り)
  const resolvedUrl = resolveExternalActionUrl(action.url, formContext, gate);
  if (!resolvedUrl) {
    // eslint-disable-next-line no-alert
    window.alert("URL が不正です (http:// または https:// で始まる必要があります)。フォーム設定を確認してください。");
    return;
  }
  // ユーザージェスチャ中に結果タブを確保（この後 await を挟んでも POST 先を失わない）。
  const target = openExternalActionWindow();
  let childFormsByRow = null;
  if (typeof searchChildFormsResolver === "function") {
    const entries = Array.isArray(outputTargetRows) ? outputTargetRows.map((row) => row.entry).filter(Boolean) : [];
    try {
      childFormsByRow = await searchChildFormsResolver(entries);
    } catch (_e) {
      childFormsByRow = null; // 取得失敗時は子データ無しで送信（無言）。
    }
  }
  const payload = buildExternalActionPayload({
    context: "search",
    formId: formContext?.formId,
    formName: formContext?.formName,
    base: buildSearchPayloadBase(form, outputTargetRows, childFormsByRow),
    storageFields: formContext,
    gate,
  });
  submitExternalActionPost(resolvedUrl, payload, target);
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
