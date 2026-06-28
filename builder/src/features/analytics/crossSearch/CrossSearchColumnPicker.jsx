import React from "react";

/**
 * 串刺しフォーム検索の「列名呼び出し」表（表示専用 + チェックボックス選択）。
 *
 * 行 = 統合列（スラッシュパス）。列 = 各フォーム。セルは表示対象 / 非表示(グレー) / 列なし。
 * チェックボックスは統合列単位で、串刺し検索に出す列を選ぶ。
 *
 * @param {{ forms: {formId, formName}[], rows: object[] }} table buildColumnPickerTable の出力
 * @param {Set<string>} selectedPaths 選択中の列パス
 * @param {(path: string, checked: boolean) => void} onToggle
 * @param {(checked: boolean) => void} onToggleAll
 */
export default function CrossSearchColumnPicker({ table, selectedPaths, onToggle, onToggleAll }) {
  const rows = (table && Array.isArray(table.rows)) ? table.rows : [];
  const forms = (table && Array.isArray(table.forms)) ? table.forms : [];
  if (rows.length === 0) {
    return <p className="nf-text-subtle">表示対象の列がありません。フォームを選んで「列名呼び出し」を押してください。</p>;
  }
  const allChecked = rows.every((r) => selectedPaths.has(r.path));

  const cellLabel = (state) => (state === "absent" ? "" : "○");

  return (
    <div className="search-table-wrap">
      <table className="search-table cfs-column-picker">
        <thead>
          <tr>
            <th className="search-th">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => onToggleAll(e.target.checked)}
                title="すべて選択 / 解除"
              />
            </th>
            <th className="search-th">列名（フォーム横断）</th>
            {forms.map((f) => (
              <th key={f.formId} className="search-th" title={f.formName}>{f.formName}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <td className="search-td" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedPaths.has(row.path)}
                  onChange={(e) => onToggle(row.path, e.target.checked)}
                />
              </td>
              <td className="search-td nf-fw-600" title={row.path}>{row.path}</td>
              {forms.map((f) => {
                const state = row.cells[f.formId] || "absent";
                return (
                  <td
                    key={f.formId}
                    className={`search-td nf-text-center${state === "present" ? " cfs-col-gray" : ""}`}
                    title={state === "displayed" ? "表示対象" : state === "present" ? "列はあるが表示対象外" : "列なし"}
                  >
                    {cellLabel(state)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
