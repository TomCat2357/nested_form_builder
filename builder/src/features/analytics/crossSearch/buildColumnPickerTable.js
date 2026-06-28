/**
 * 串刺しフォーム検索（cross-form search）編集画面の「列名呼び出し」表を構築する純関数。
 *
 * 複数フォームの列を横断統合し、同一スラッシュパスを 1 行に重ねる。各フォームについて
 * 「表示対象（displayed）/ 列はあるが非表示（present＝グレー）/ 列なし（absent）」の 3 状態を持つ。
 * チェックボックスで選ぶ単位は「統合列（path）」。結果テーブルは同一 path を 1 列に統合するため。
 *
 * 入力: forms = [{ formId, formName, schema }]
 * 出力: {
 *   forms: [{ formId, formName }],            // 列ヘッダ（フォーム）の順序
 *   rows: [{
 *     path, label, segments, type,            // path=識別子 / type=最初に表示するフォームの型
 *     cells: { [formId]: "displayed"|"present"|"absent" },
 *     displayedFormIds: [formId...],
 *     presentFormIds: [formId...],
 *   }]
 * }
 */

import { collectDisplayFieldSettings } from "../../../utils/formPaths.js";
import { forEachFormField } from "../utils/fieldMetas.js";
import { splitFieldPath } from "../../../utils/pathCodec.js";

// 串刺し検索の列ピッカー / 統合から除外する型。値列を持たないアクション/表示専用フィールドは
// フォームごとの重い解決機構が要るため v1 では対象外（risk 参照）。externalAction は
// collectDisplayFieldSettings 側で既に除外済みだが明示する。
export const CROSS_SEARCH_EXCLUDED_TYPES = new Set(["externalAction", "printTemplate", "formLink"]);

export function buildColumnPickerTable(forms) {
  const formList = Array.isArray(forms) ? forms.filter((f) => f && f.formId) : [];
  const headerForms = formList.map((f) => ({
    formId: String(f.formId),
    formName: String(f.formName || ""),
  }));

  // フォームごとに「表示対象パス → 型」「存在パス（全フィールド）」を集める。
  const displayedByForm = new Map();
  const presentByForm = new Map();
  for (const f of formList) {
    const formId = String(f.formId);
    const displayed = new Map();
    collectDisplayFieldSettings(f.schema || []).forEach((item) => {
      const path = String(item?.path || "");
      if (!path) return;
      if (CROSS_SEARCH_EXCLUDED_TYPES.has(item?.type)) return;
      if (!displayed.has(path)) displayed.set(path, item?.type || "");
    });
    displayedByForm.set(formId, displayed);

    const present = new Set();
    forEachFormField({ schema: f.schema || [] }, ({ field, pipePath }) => {
      if (!pipePath) return;
      if (CROSS_SEARCH_EXCLUDED_TYPES.has(field?.type)) return;
      present.add(pipePath);
    });
    presentByForm.set(formId, present);
  }

  // 行 = いずれかのフォームで「表示対象」の path（出現順にユニーク化＝縦に重ねる）。
  const rowOrder = [];
  const rowByPath = new Map();
  for (const f of formList) {
    const formId = String(f.formId);
    const displayed = displayedByForm.get(formId);
    for (const [path, type] of displayed) {
      if (!rowByPath.has(path)) {
        rowByPath.set(path, { path, type, displayedFormIds: [], presentFormIds: [] });
        rowOrder.push(path);
      }
    }
  }

  const rows = rowOrder.map((path) => {
    const acc = rowByPath.get(path);
    const cells = {};
    for (const { formId } of headerForms) {
      const displayed = displayedByForm.get(formId);
      const present = presentByForm.get(formId);
      if (displayed && displayed.has(path)) {
        cells[formId] = "displayed";
        acc.displayedFormIds.push(formId);
      } else if (present && present.has(path)) {
        cells[formId] = "present";
        acc.presentFormIds.push(formId);
      } else {
        cells[formId] = "absent";
      }
    }
    const segments = splitFieldPath(path);
    return {
      path,
      label: segments[segments.length - 1] || path,
      segments,
      type: acc.type || "",
      cells,
      displayedFormIds: acc.displayedFormIds,
      presentFormIds: acc.presentFormIds,
    };
  });

  return { forms: headerForms, rows };
}
