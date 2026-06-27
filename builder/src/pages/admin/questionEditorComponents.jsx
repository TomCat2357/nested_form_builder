// QuestionEditorPage のプレゼンテーショナル子コンポーネント。
// DOM 構造・props・className を元ページから一切変えずに再配置したもの。状態は持たない。

import React from "react";
import GuiQueryBuilder from "../../features/analytics/components/GuiQueryBuilder.jsx";
import SearchableSelect from "../../app/components/SearchableSelect.jsx";
import { formsToOptions, columnsToOptions } from "../../app/components/searchableSelectOptions.js";
import { formQualifiedName } from "../../features/analytics/utils/formIdentifierResolver.js";

// フォーム名 / 列名のトークン表示行で共用するスタイル。
const TOKEN_ROW_STYLE = { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" };
const TOKEN_CODE_STYLE = { fontFamily: "monospace", background: "var(--nf-input-bg, #f6f6f6)", border: "1px solid var(--nf-border)", borderRadius: "3px", padding: "2px 6px" };

// Question 名 / フォルダ / 実体 URL / 保存先案内のメタ情報入力ブロック。
export function QuestionMetaFields({
  name,
  onNameChange,
  folder,
  onFolderChange,
  questionId,
  driveFileUrl,
}) {
  return (
    <>
      <div>
        <label className="nf-label">Question 名</label>
        <input
          className="nf-input"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="例: 月別集計"
          style={{ width: "100%", maxWidth: "400px" }}
        />
      </div>

      <div>
        <label className="nf-label">フォルダ（任意）</label>
        <input
          className="nf-input"
          type="text"
          value={folder}
          onChange={(e) => onFolderChange(e.target.value)}
          placeholder="例: 営業/月次  （空欄=フォルダなし）"
          style={{ width: "100%", maxWidth: "400px" }}
        />
      </div>

      {questionId && driveFileUrl && (
        <div>
          <label className="nf-label">実体ファイル URL（Drive 上の JSON）</label>
          <input
            className="nf-input nf-input--readonly"
            type="text"
            value={driveFileUrl}
            readOnly
            onFocus={(e) => e.target.select()}
            title="この Question の実体（Drive 上の JSON ファイル）の URL。表示専用で編集できません。"
            style={{ width: "100%", maxWidth: "640px", background: "var(--surface-subtle)", color: "var(--text-muted)" }}
          />
          <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
            この Question 定義が保存されている Drive 上の場所です。どれが実体かを確認するための表示専用で、編集はできません。
          </p>
        </div>
      )}

      <p className="nf-text-11 nf-text-muted nf-mb-0">
        Question 定義は標準フォルダ構成の <code>02_questions</code> に保存されます。
      </p>
    </>
  );
}

// クエリ作成方法（GUI / SQL）の選択ラジオ。
export function QueryModeFieldset({ mode, onSwitchToGui, onSwitchToSql }) {
  return (
    <fieldset style={{ border: "1px solid var(--nf-border)", borderRadius: "4px", padding: "8px 12px", margin: 0 }}>
      <legend style={{ fontSize: "12px", padding: "0 6px" }}>クエリ作成方法</legend>
      <label style={{ marginRight: "16px" }}>
        <input
          type="radio"
          name="query-mode"
          value="gui"
          checked={mode === "gui"}
          onChange={onSwitchToGui}
          style={{ marginRight: "4px" }}
        />
        GUI
      </label>
      <label>
        <input
          type="radio"
          name="query-mode"
          value="sql"
          checked={mode === "sql"}
          onChange={onSwitchToSql}
          style={{ marginRight: "4px" }}
        />
        SQL
      </label>
    </fieldset>
  );
}

// クエリ実行ボタン（GUI / SQL で共用）。
export function RunQueryButton({ running, onRun }) {
  return (
    <button type="button" onClick={onRun} disabled={running} className="nf-btn-outline">
      {running ? "実行中..." : "クエリ実行"}
    </button>
  );
}

// GUI モードのクエリ作成パネル。
export function QuestionGuiPanel({
  gui,
  onGuiChange,
  formColumns,
  activeForms,
  onFormChange,
  columnLoadError,
  running,
  onRun,
}) {
  return (
    <>
      {columnLoadError && <p className="nf-text-warning">列情報の取得に失敗: {columnLoadError}</p>}
      <GuiQueryBuilder
        gui={gui}
        onChange={onGuiChange}
        formColumns={formColumns}
        activeForms={activeForms}
        onFormChange={onFormChange}
      />
      <div>
        <RunQueryButton running={running} onRun={onRun} />
      </div>
    </>
  );
}

// SQL モードのデータソース選択＋識別子トークン表示。
function QuestionSqlSourcePanel({
  selectedFormId,
  onSelectedFormIdChange,
  activeForms,
  forms,
  formColumns,
  selectedColumnKey,
  onSelectedColumnKeyChange,
  copiedToken,
  onCopyToken,
}) {
  return (
    <div>
      <label className="nf-label">データソース（既定フォーム・任意）</label>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
        <SearchableSelect
          value={selectedFormId}
          onChange={onSelectedFormIdChange}
          placeholder="（未選択：SQL 内で [フォーム名] を直接参照）"
          options={formsToOptions(activeForms)}
          style={{ maxWidth: "400px", flex: "0 0 auto" }}
        />
        {selectedFormId && (() => {
          const f = forms.find((x) => x.id === selectedFormId);
          if (!f) return null;
          const title = formQualifiedName(f) || f.id;
          // 参照は常にフォーム名で行う（fileId は保存時に内部で置換される内部表現）。
          const formNameToken = "[" + title + "]";
          const selectedCol = formColumns.find((c) => c.key === selectedColumnKey);
          const columnToken = selectedCol ? "[" + selectedCol.key + "]" : "";
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={TOKEN_ROW_STYLE}>
                <span className="nf-text-muted" style={{ minWidth: "70px" }}>フォーム名:</span>
                <code style={TOKEN_CODE_STYLE}>{formNameToken}</code>
                <button type="button" className="nf-btn-outline" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={() => onCopyToken(formNameToken)}>
                  {copiedToken === formNameToken ? "コピー済" : "コピー"}
                </button>
              </div>
              {formColumns.length > 0 && (
                <div style={TOKEN_ROW_STYLE}>
                  <span className="nf-text-muted" style={{ minWidth: "70px" }}>列名:</span>
                  <SearchableSelect
                    value={selectedColumnKey}
                    onChange={onSelectedColumnKeyChange}
                    placeholder="（列を選択）"
                    searchPlaceholder="列名で絞り込み..."
                    options={columnsToOptions(formColumns)}
                    style={{ maxWidth: "300px", flex: "0 0 auto" }}
                  />
                  {columnToken && <code style={TOKEN_CODE_STYLE}>{columnToken}</code>}
                  {columnToken && (
                    <button type="button" className="nf-btn-outline" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={() => onCopyToken(columnToken)}>
                      {copiedToken === columnToken ? "コピー済" : "コピー"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// SQL モードのクエリ作成パネル（データソース選択＋SQL テキストエリア）。
export function QuestionSqlPanel({
  selectedFormId,
  onSelectedFormIdChange,
  activeForms,
  forms,
  formColumns,
  selectedColumnKey,
  onSelectedColumnKeyChange,
  copiedToken,
  onCopyToken,
  sql,
  onSqlChange,
  running,
  onRun,
}) {
  return (
    <>
      <QuestionSqlSourcePanel
        selectedFormId={selectedFormId}
        onSelectedFormIdChange={onSelectedFormIdChange}
        activeForms={activeForms}
        forms={forms}
        formColumns={formColumns}
        selectedColumnKey={selectedColumnKey}
        onSelectedColumnKeyChange={onSelectedColumnKeyChange}
        copiedToken={copiedToken}
        onCopyToken={onCopyToken}
      />
      <div>
        <label className="nf-label">SQL（AlaSQL 方言）</label>
        <textarea
          value={sql}
          onChange={(e) => onSqlChange(e.target.value)}
          rows={8}
          style={{ width: "100%", fontFamily: "monospace", fontSize: "13px", padding: "8px", boxSizing: "border-box", border: "1px solid var(--nf-border)", borderRadius: "4px", background: "var(--nf-input-bg, #fff)", color: "var(--nf-text)", resize: "vertical", minHeight: "160px" }}
          placeholder={"例: SELECT [基本情報|区], COUNT(*) AS count FROM [data] GROUP BY [基本情報|区]\n他フォーム参照: SELECT * FROM [フォーム名] AS f\nバッククォートも使用可: SELECT * FROM `フォーム名`"}
        />
        <div style={{ marginTop: "6px" }}>
          <RunQueryButton running={running} onRun={onRun} />
        </div>
      </div>
    </>
  );
}
