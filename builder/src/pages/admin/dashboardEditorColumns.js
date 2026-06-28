// DashboardEditorPage の列メタ集約ロジック（純関数）。
// 簡易フィルタの項目候補を、ダッシュボードの各カードが参照するフォームから
// 集約する変換をコンポーネントから切り出す。副作用なし。
// getFormColumns はテスト容易性のため注入可能にする（既定で実装を読み込む）。

import { getFormColumns as defaultGetFormColumns } from "../../features/analytics/analyticsSchemaColumns.js";

// フォーム schema の列型 ("number"|"date"|"string"|"boolean"|"unknown") を
// 簡易フィルタの valueType ("number"|"date"|"text") へマップする。
export function columnTypeToValueType(type) {
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "text";
}

// 簡易フィルタの項目候補を集約する。
// ダッシュボードの各カード（Question）が参照するフォームから列メタ（view 形式）を
// 集約し、AlaSQL safe key で重複排除する。
//  - cards: dashboard.cards
//  - questionsById: Map<questionId, question>
//  - forms: フォーム一覧
//  - getFormColumns: フォーム → 列メタ（既定は analyticsSchemaColumns の実装）
// 返り値: [{ alaSqlKey, key, label, type }]
export function computeAvailableColumns({ cards, questionsById, forms, getFormColumns = defaultGetFormColumns }) {
  const formsById = new Map((forms || []).map((f) => [f.id, f]));
  const byKey = new Map(); // alaSqlKey -> { alaSqlKey, key, label, type }
  const addFormColumns = (formId) => {
    const form = formsById.get(formId);
    if (!form) return;
    for (const c of getFormColumns(form)) {
      if (!byKey.has(c.alaSqlKey)) {
        byKey.set(c.alaSqlKey, { alaSqlKey: c.alaSqlKey, key: c.key, label: c.label, type: c.type });
      }
    }
  };
  for (const card of cards || []) {
    const q = questionsById.get(card.questionId);
    if (!q || !q.query) continue;
    if (q.query.mode === "gui" && q.query.gui?.formId) {
      addFormColumns(q.query.gui.formId);
    } else if (q.query.mode === "sql" && Array.isArray(q.query.formSources)) {
      for (const s of q.query.formSources) addFormColumns(s.formId);
    }
  }
  return Array.from(byKey.values());
}
