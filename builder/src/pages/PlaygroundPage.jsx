import React, { useEffect, useMemo, useRef, useState } from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useCancellable } from "../app/hooks/useCancellable.js";
import SearchableSelect from "../app/components/SearchableSelect.jsx";
import { formsToOptions } from "../app/components/searchableSelectOptions.js";
import { dataStore } from "../app/state/dataStore.js";
import { getSheetConfig } from "../app/state/dataStoreHelpers.js";
import { executeQuestion, ERR_NO_SPREADSHEET } from "../features/analytics/analyticsStore.js";
import ResultTable from "../features/analytics/components/ResultTable.jsx";
import { buildLiveViewRow } from "../features/analytics/entriesToViewRows.js";
import { entriesToViewTableRows } from "../features/analytics/entriesToViewRows.js";
import { resolveTemplateAsync } from "../features/expression/templateEvaluator.js";
import { compileExpression, evalExpressionSync } from "../features/expression/alasqlExpressionEvaluator.js";
import { prefetchQueryTokens } from "../utils/tokenReplacer.js";
import { restoreResponsesFromData } from "../utils/responses.js";
import { buildRecordItems } from "../features/preview/printDocument.js";
import { buildExternalActionPayload } from "../utils/externalActionPost.js";
import { collectFormLinkFields, getChildFormCached_, buildChildDataObject } from "../features/preview/childFormData.js";
import { hasScriptRun, listRecordsByPids } from "../services/gasClient.js";
import { buildChildFormUrl } from "../utils/formShareUrl.js";
import { normalizeSchemaIDs } from "../core/schema.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";
import { buildSearchColumns, buildSimpleSearchColumns, createBaseColumns } from "../features/search/searchTable.js";
import { buildSearchExpression } from "../features/search/searchExpressionBuilder.js";
import { filterRowsByExpr } from "../features/analytics/analyticsAlaSql.js";
import { SQL_MODE_RE } from "../features/search/searchSyntaxPreprocessor.js";
import { triggerCsvDownload } from "../features/analytics/utils/exportResultData.js";
import { readSettingsValue, writeSettingsValue } from "../core/storage.js";
import { formFieldPaths, computeInsertion } from "./playgroundHelpers.js";

// SQL / テンプレート入力の共通 monospace テキストエリア（QuestionEditorPage と同じ流儀）。
const monoTextareaStyle = {
  width: "100%",
  fontFamily: "monospace",
  fontSize: "13px",
  padding: "8px",
  boxSizing: "border-box",
  border: "1px solid var(--nf-border)",
  borderRadius: "4px",
  background: "var(--nf-input-bg, #fff)",
  color: "var(--nf-text)",
  resize: "vertical",
};

const codeBlockStyle = {
  fontFamily: "monospace",
  fontSize: "13px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: 0,
  maxHeight: "520px",
  overflow: "auto",
};

const baseUrl_ = () => (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";

// スニペット永続化（IndexedDB settings ストア）のキーと空形。
const SNIPPET_KEY = "playground_snippets";
const EMPTY_SNIPPETS = { sql: [], search: [], template: [], expression: [] };

// textarea のカーソル位置へ snippet を差し込み、挿入後の位置にキャレットを戻す。
// 文字列操作の純粋部分は computeInsertion（playgroundHelpers）に委譲する。
function insertAtCursor(el, currentValue, snippet, setValue) {
  const value = currentValue || "";
  const start = el && typeof el.selectionStart === "number" ? el.selectionStart : value.length;
  const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : value.length;
  const { next, caret } = computeInsertion(value, start, end, snippet);
  setValue(next);
  if (!el) return;
  // setState 反映後にフォーカス・キャレット位置を復元する。
  requestAnimationFrame(() => {
    try {
      el.focus();
      el.setSelectionRange(caret, caret);
    } catch (_) {
      // 一部環境で setSelectionRange が使えなくても挿入自体は成立しているので無視。
    }
  });
}

// 全モード共通の「フィールド挿入」セレクト。選択するとパスをトークン化して挿入する。
function FieldInsertPicker({ paths, onInsert }) {
  if (!paths || paths.length === 0) return null;
  return (
    <div style={{ marginTop: "6px" }}>
      <SearchableSelect
        value=""
        onChange={(p) => { if (p) onInsert(p); }}
        placeholder="＋ フィールド挿入"
        searchPlaceholder="フィールド名で絞り込み..."
        options={paths.map((p) => ({ value: p, label: p, folder: "" }))}
        style={{ maxWidth: "400px" }}
      />
    </div>
  );
}

// 各エディタ共通のスニペット保存 / 呼び出しバー。
function SnippetBar({ category, snippets, currentBody, onSave, onLoad }) {
  const list = (snippets && snippets[category]) || [];
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" }}>
      <button
        type="button"
        className="nf-btn-outline"
        style={{ padding: "2px 8px", fontSize: "11px" }}
        onClick={() => onSave(category, currentBody)}
      >
        スニペット保存
      </button>
      {list.length > 0 && (
        <SearchableSelect
          value=""
          onChange={(name) => { const s = list.find((x) => x.name === name); if (s) onLoad(s.body); }}
          placeholder="（保存済みを呼び出し）"
          searchPlaceholder="名前で絞り込み..."
          options={list.map((s) => ({ value: s.name, label: s.name, folder: "" }))}
          style={{ maxWidth: "260px" }}
        />
      )}
    </div>
  );
}

export default function PlaygroundPage() {
  const { isAdmin, userEmail } = useAuth();
  const { forms } = useAppData();
  const activeForms = useMemo(() => (forms || []).filter((f) => !f.archived && !f.childOnly), [forms]);

  const [mode, setMode] = useState("question"); // "question" | "search" | "template" | "expression" | "externalAction"

  // --- Question モード（SQL → 表）---
  const [qFormId, setQFormId] = useState("");
  const [qFullForm, setQFullForm] = useState(null); // フィールド挿入候補用に schema を読む
  const [qSql, setQSql] = useState("");
  const [qResult, setQResult] = useState(null);
  const [qError, setQError] = useState(null);
  const [qRunning, setQRunning] = useState(false);
  const qSqlRef = useRef(null);

  // --- template / externalAction / expression / search 共有（フォーム + レコード選択）---
  const [selectedFormId, setSelectedFormId] = useState("");
  const [fullForm, setFullForm] = useState(null); // schema を含む完全なフォーム（getForm で取得・正規化済み）
  const [entries, setEntries] = useState([]);
  const [entriesError, setEntriesError] = useState(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState("");

  // --- 検索モード ---
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState(null); // { matched: Entry[], total }
  const [searchError, setSearchError] = useState(null);
  const [searchRunning, setSearchRunning] = useState(false);
  const searchRef = useRef(null);

  // --- template モード ---
  const [template, setTemplate] = useState("");
  const [tplResult, setTplResult] = useState("");
  const [tplDone, setTplDone] = useState(false);
  const [tplError, setTplError] = useState(null);
  const [tplRunning, setTplRunning] = useState(false);
  const templateRef = useRef(null);

  // --- 式評価モード ---
  const [expr, setExpr] = useState("");
  const [exprResult, setExprResult] = useState(null); // { value, type }
  const [exprError, setExprError] = useState(null);
  const [exprRunning, setExprRunning] = useState(false);
  const exprRef = useRef(null);

  // --- 外部アクション モード ---
  const [externalActionJson, setExternalActionJson] = useState("");
  const [whWarn, setWhWarn] = useState("");
  const [whError, setWhError] = useState(null);
  const [whRunning, setWhRunning] = useState(false);
  const [whAdminGate, setWhAdminGate] = useState(true);
  const [copied, setCopied] = useState(false);

  // --- スニペット（全モード共有・IndexedDB 永続）---
  const [snippets, setSnippets] = useState(EMPTY_SNIPPETS);

  useEffect(() => {
    let alive = true;
    readSettingsValue(SNIPPET_KEY).then((v) => {
      if (alive && v && typeof v === "object") setSnippets({ ...EMPTY_SNIPPETS, ...v });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const handleSaveSnippet = (category, body) => {
    const trimmed = (body || "").trim();
    if (!trimmed) return;
    const name = (typeof window !== "undefined" ? (window.prompt("スニペット名を入力", "") || "") : "").trim();
    if (!name) return;
    setSnippets((prev) => {
      const list = ((prev && prev[category]) || []).filter((s) => s.name !== name);
      const next = { ...EMPTY_SNIPPETS, ...prev, [category]: [...list, { name, body }] };
      writeSettingsValue(SNIPPET_KEY, next);
      return next;
    });
  };

  // Question モードのデータソース form の schema をフィールド挿入候補用に読む。
  useCancellable(async (isCancelled) => {
    setQFullForm(null);
    if (!qFormId) return;
    try {
      const form = await dataStore.getForm(qFormId);
      if (isCancelled()) return;
      setQFullForm(form ? { ...form, schema: normalizeSchemaIDs(form.schema || []) } : null);
    } catch (_) {
      // 候補が出ないだけなので握りつぶす（SQL 実行は qFormId のみで成立する）。
    }
  }, [qFormId]);

  // selectedFormId が変わるたびに、完全フォーム（schema）と実レコードをロードする。
  useCancellable(async (isCancelled) => {
    setSelectedRecordId("");
    setFullForm(null);
    setEntries([]);
    setEntriesError(null);
    setTplResult("");
    setTplDone(false);
    setExprResult(null);
    setExprError(null);
    setSearchResult(null);
    setSearchError(null);
    setExternalActionJson("");
    setWhWarn("");
    if (!selectedFormId) return;
    setEntriesLoading(true);
    try {
      const form = await dataStore.getForm(selectedFormId);
      if (isCancelled()) return;
      const normForm = form ? { ...form, schema: normalizeSchemaIDs(form.schema || []) } : null;
      setFullForm(normForm);
      try {
        const res = await dataStore.listEntries(selectedFormId);
        if (isCancelled()) return;
        // ソフトデリート済みは候補から除外する。
        const live = (res.entries || []).filter((e) => !e.deletedAt && !e.deletedAtUnixMs);
        setEntries(live);
        // formLink で紐づく子フォームのレコードをメモリに先読みする。
        // {{SELECT ... FROM [子フォーム名]}} の full-query は cacheOnly=true でメモリのみ参照するため、
        // ここで listEntries しておかないとテンプレ評価時に 0 件（空文字）になる。
        if (normForm) {
          const childFields = collectFormLinkFields(normForm.schema || []);
          await Promise.all(childFields.map(async (field) => {
            if (!field.childFormId || isCancelled()) return;
            try {
              await dataStore.listEntries(field.childFormId);
            } catch (_) {
              // 子フォームが取得できなくてもテンプレ評価は続ける（その子は 0 件扱い）。
            }
          }));
        }
      } catch (err) {
        if (isCancelled()) return;
        setEntriesError(err?.message || String(err));
      }
    } catch (err) {
      if (isCancelled()) return;
      setEntriesError(err?.message || String(err));
    } finally {
      if (!isCancelled()) setEntriesLoading(false);
    }
  }, [selectedFormId]);

  const recordOptions = useMemo(
    () => entries.map((e) => ({ value: e.id, label: `#${e["No."] ?? "?"} · ${e.id}`, folder: "" })),
    [entries]
  );
  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedRecordId) || null,
    [entries, selectedRecordId]
  );

  // フィールド挿入候補（パス一覧）。
  const sharedFieldPaths = useMemo(() => formFieldPaths(fullForm), [fullForm]);
  const qFieldPaths = useMemo(() => formFieldPaths(qFullForm), [qFullForm]);

  // SQL モード用の formSources（QuestionEditorPage.buildSqlFormSources と同等）。
  const buildSqlFormSources = () => {
    if (!qFormId) return { formSources: [] };
    const form = forms.find((f) => f.id === qFormId);
    if (!form) return { formSources: [] };
    if (!getSheetConfig(form)) return { error: ERR_NO_SPREADSHEET };
    return { formSources: [{ formId: form.id, alias: "data" }] };
  };

  const handleRunQuestion = async () => {
    setQError(null);
    setQResult(null);
    if (!qSql.trim()) return;
    const src = buildSqlFormSources();
    if (src.error) {
      setQError(src.error);
      return;
    }
    setQRunning(true);
    try {
      const result = await executeQuestion(
        { query: { mode: "sql", formSources: src.formSources, sql: qSql } },
        { forms }
      );
      if (result.ok) setQResult(result);
      else setQError(result.error);
    } catch (err) {
      setQError(err?.message || String(err));
    } finally {
      setQRunning(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!qResult?.ok) return;
    triggerCsvDownload(
      qResult.rows,
      qResult.columns,
      qResult.compiledColumns || null,
      `playground_${Date.now()}.csv`,
      { sql: qSql }
    );
  };

  // 検索モード: SearchPage（useSearchPageState）の簡易検索フィルタと同じ経路で実レコードを絞り込む。
  const handleRunSearch = async () => {
    setSearchError(null);
    setSearchResult(null);
    if (!fullForm) {
      setSearchError("フォームを選択してください。");
      return;
    }
    const q = searchQuery.trim();
    if (!q) return;
    if (SQL_MODE_RE.test(q)) {
      setSearchError("SELECT 始まりの SQL は Question モードで実行してください（検索モードは簡易検索構文専用です）。");
      return;
    }
    setSearchRunning(true);
    try {
      // 表示列 + 非表示メタ列の superset → 簡易検索用 superset（スキーマ全フィールド）。
      const columns = buildSearchColumns(fullForm);
      const presentKeys = new Set(columns.map((c) => c.key));
      const hiddenMeta = createBaseColumns().filter((c) => !presentKeys.has(c.key));
      const searchColumns = hiddenMeta.length ? [...columns, ...hiddenMeta] : columns;
      const simpleSearchColumns = buildSimpleSearchColumns(fullForm, searchColumns);
      const { expr: whereExpr, errors } = buildSearchExpression(q, simpleSearchColumns);
      if (errors && errors.length > 0) {
        setSearchError(errors.join(", "));
        return;
      }
      // 空 expr（"()" 等の空 AST）は全件一致扱い。
      if (!whereExpr) {
        setSearchResult({ matched: entries, total: entries.length });
        return;
      }
      const rows = entriesToViewTableRows(entries, fullForm);
      const res = await filterRowsByExpr(rows, whereExpr);
      if (!res.ok) {
        setSearchError("検索エラー: " + (res.error || "式を評価できませんでした"));
        return;
      }
      const idSet = new Set();
      for (const r of res.rows) {
        if (r && r.id != null && r.id !== "") idSet.add(r.id);
      }
      const matched = entries.filter((e) => idSet.has(e.id));
      setSearchResult({ matched, total: entries.length });
    } catch (err) {
      setSearchError(err?.message || String(err));
    } finally {
      setSearchRunning(false);
    }
  };

  const handleRunTemplate = async () => {
    setTplError(null);
    setTplResult("");
    setTplDone(false);
    if (!fullForm || !selectedEntry) {
      setTplError("フォームとレコードを選択してください。");
      return;
    }
    setTplRunning(true);
    try {
      const row = buildLiveViewRow(fullForm, selectedEntry);
      // full-query トークン（{{SELECT ...}}）を本番（PreviewPage）と同じ経路で事前解決する。
      // runFullQuery は cacheOnly（ローカル常駐データのみ・サーバ同期なし）で動く。
      const queryTokenValues = await prefetchQueryTokens(template, {
        recordId: selectedEntry.id,
        formId: fullForm.id,
        forms,
        liveRowOverride: row,
      });
      const out = await resolveTemplateAsync(template, row, {
        fallback: "",
        queryTokenValues,
        logError: (err, tok) => console.warn("[Playground] token eval failed", tok, err),
      });
      setTplResult(out);
      setTplDone(true);
    } catch (err) {
      setTplError(err?.message || String(err));
    } finally {
      setTplRunning(false);
    }
  };

  // 式評価モード: 単一 alasql 式（SELECT/FROM を書かない式本体）をレコード行に対して評価する。
  const handleRunExpression = async () => {
    setExprError(null);
    setExprResult(null);
    if (!fullForm || !selectedEntry) {
      setExprError("フォームとレコードを選択してください。");
      return;
    }
    const e = expr.trim();
    if (!e) return;
    setExprRunning(true);
    try {
      await compileExpression(e); // コンパイル失敗は throw → 下の catch で表示
      const row = buildLiveViewRow(fullForm, selectedEntry);
      const v = evalExpressionSync(e, row, { fallback: null });
      setExprResult({ value: v, type: v === null ? "null" : (Array.isArray(v) ? "array" : typeof v) });
    } catch (err) {
      setExprError(err?.message || String(err));
    } finally {
      setExprRunning(false);
    }
  };

  const handleRunExternalAction = async () => {
    setWhError(null);
    setExternalActionJson("");
    setWhWarn("");
    if (!fullForm || !selectedEntry) {
      setWhError("フォームとレコードを選択してください。");
      return;
    }
    setWhRunning(true);
    try {
      const schema = fullForm.schema;
      const entry = selectedEntry;
      const responses = restoreResponsesFromData(schema, entry.data, entry.dataUnixMs);

      // 子フォーム（formLink）を実外部アクション と同じく record.items 列へ完全展開する。
      const childDataByFieldId = {};
      let warn = "";
      if (hasScriptRun()) {
        const fields = collectFormLinkFields(schema);
        const base = baseUrl_();
        await Promise.all(fields.map(async (field) => {
          try {
            const [childForm, records] = await Promise.all([
              getChildFormCached_(field.childFormId),
              listRecordsByPids({ formId: field.childFormId, pids: [entry.id] }),
            ]);
            childDataByFieldId[field.id] = buildChildDataObject({
              childFormId: field.childFormId,
              childFormName: field.childFormName,
              childFormUrl: buildChildFormUrl(base, field.childFormId, entry.id),
              childSchema: childForm?.schema || [],
              records,
            });
          } catch (_e) {
            warn = "一部の子フォームの取得に失敗しました（その項目は展開されません）。";
          }
        }));
      } else {
        warn = "ローカル環境では子フォーム（formLink）データを取得できません。実際の展開はデプロイ環境で確認してください。";
      }

      const items = buildRecordItems(schema, responses, { childDataByFieldId });
      const record = { id: entry.id, no: entry["No."] ?? "", items };
      // 起動元に依らない統一フォーマット（records 配列 + recordCount）。プレビューは常に 1 件。
      const payload = buildExternalActionPayload({
        formId: fullForm.id,
        formName: fullForm.settings?.formTitle || "",
        base: { records: [record], recordCount: 1 },
        storageFields: {
          spreadsheetId: normalizeSpreadsheetId(fullForm.settings?.spreadsheetId || ""),
          sheetName: fullForm.settings?.sheetName || "Data",
          driveFileUrl: fullForm.driveFileUrl || "",
          userEmail,
        },
        gate: { adminOnly: whAdminGate, isAdmin },
      });
      setExternalActionJson(JSON.stringify(payload, null, 2));
      setWhWarn(warn);
    } catch (err) {
      setWhError(err?.message || String(err));
    } finally {
      setWhRunning(false);
    }
  };

  const copyExternalActionJson = () => {
    if (!externalActionJson) return;
    navigator.clipboard.writeText(externalActionJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  if (!isAdmin) return null;

  // template / externalAction / expression / search 共有のフォーム + レコードピッカー。
  // recordOnly=true のときはレコードセレクトを省く（検索モードはフォームのみ）。
  const renderSharedPickers = (recordOnly = false) => (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
      <div>
        <label className="nf-label">フォーム</label>
        <SearchableSelect
          value={selectedFormId}
          onChange={setSelectedFormId}
          placeholder="（フォームを選択）"
          options={formsToOptions(activeForms)}
          style={{ maxWidth: "400px" }}
        />
      </div>
      {!recordOnly && (
        <div>
          <label className="nf-label">レコード</label>
          <SearchableSelect
            value={selectedRecordId}
            onChange={setSelectedRecordId}
            placeholder={entriesLoading ? "（読み込み中...）" : "（レコードを選択）"}
            searchPlaceholder="No. / ID で絞り込み..."
            options={recordOptions}
            style={{ maxWidth: "400px" }}
          />
          {entriesError && <p className="nf-text-warning nf-mt-4 nf-mb-0">レコード取得に失敗: {entriesError}</p>}
          {!entriesError && !entriesLoading && selectedFormId && entries.length === 0 && (
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">表示できるレコードがありません（デプロイ環境で実データを確認してください）。</p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <AppLayout title="Playground" fallbackPath="/admin" backHidden={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p className="nf-text-11 nf-text-muted nf-mb-0">
          Question の SQL・検索クエリ・置換テンプレート・単一式・外部アクションの POST ペイロードを、実データに対してその場で試せます（管理者専用）。
        </p>

        <fieldset style={{ border: "1px solid var(--nf-border)", borderRadius: "4px", padding: "8px 12px", margin: 0 }}>
          <legend style={{ fontSize: "12px", padding: "0 6px" }}>モード</legend>
          {[
            ["question", "Question（SQL → 表）"],
            ["search", "検索（クエリ → 一致レコード）"],
            ["template", "置換（テンプレート → 文字列）"],
            ["expression", "式（単一式 → 値）"],
            ["externalAction", "外部アクション（POST ペイロード）"],
          ].map(([value, label]) => (
            <label key={value} style={{ marginRight: "16px" }}>
              <input
                type="radio"
                name="playground-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                style={{ marginRight: "4px" }}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {/* ===== Question モード ===== */}
        {mode === "question" && (
          <>
            <div>
              <label className="nf-label">データソース（既定フォーム・任意）</label>
              <SearchableSelect
                value={qFormId}
                onChange={setQFormId}
                placeholder="（未選択：SQL 内で [フォーム名] を直接参照）"
                options={formsToOptions(activeForms)}
                style={{ maxWidth: "400px" }}
              />
            </div>
            <div>
              <label className="nf-label">SQL（AlaSQL 方言）</label>
              <textarea
                ref={qSqlRef}
                value={qSql}
                onChange={(e) => setQSql(e.target.value)}
                rows={8}
                style={{ ...monoTextareaStyle, minHeight: "160px" }}
                placeholder={"例: SELECT [基本情報|区], COUNT(*) AS count FROM [data] GROUP BY [基本情報|区]\n他フォーム参照: SELECT * FROM [フォーム名] AS f\nバッククォートも使用可: SELECT * FROM `フォーム名`"}
              />
              <FieldInsertPicker
                paths={qFieldPaths}
                onInsert={(p) => insertAtCursor(qSqlRef.current, qSql, `[${p}]`, setQSql)}
              />
              <div style={{ marginTop: "6px" }}>
                <button type="button" onClick={handleRunQuestion} disabled={qRunning} className="nf-btn-outline">
                  {qRunning ? "実行中..." : "クエリ実行"}
                </button>
              </div>
              <SnippetBar
                category="sql"
                snippets={snippets}
                currentBody={qSql}
                onSave={handleSaveSnippet}
                onLoad={setQSql}
              />
            </div>
            {qError && <p className="nf-text-warning">{qError}</p>}
            {qResult?.ok && (
              <>
                <div>
                  <button type="button" className="nf-btn-outline" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={handleDownloadCsv}>
                    CSV ダウンロード
                  </button>
                </div>
                <ResultTable rows={qResult.rows} columns={qResult.columns} sql={qSql} />
              </>
            )}
          </>
        )}

        {/* ===== 検索モード ===== */}
        {mode === "search" && (
          <>
            {renderSharedPickers(true)}
            <div>
              <label className="nf-label">検索クエリ（簡易検索構文）</label>
              <textarea
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                rows={3}
                style={{ ...monoTextareaStyle, minHeight: "60px" }}
                placeholder={"例: 氏名:山田 and 年齢>=20\n複数値: 区 in (中央区, 北区)\n裸単語は全列横断"}
              />
              <FieldInsertPicker
                paths={sharedFieldPaths}
                onInsert={(p) => insertAtCursor(searchRef.current, searchQuery, `${p}:`, setSearchQuery)}
              />
              <div style={{ marginTop: "6px" }}>
                <button type="button" onClick={handleRunSearch} disabled={searchRunning} className="nf-btn-outline">
                  {searchRunning ? "実行中..." : "検索実行"}
                </button>
              </div>
              <SnippetBar
                category="search"
                snippets={snippets}
                currentBody={searchQuery}
                onSave={handleSaveSnippet}
                onLoad={setSearchQuery}
              />
              <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
                SearchPage と同じ簡易検索フィルタで評価します。SQL（<code>SELECT ...</code>）は Question モードへ。構文は <code>docs/claude/search-query-syntax.md</code> 参照。
              </p>
            </div>
            {searchError && <p className="nf-text-warning">{searchError}</p>}
            {searchResult && !searchError && (
              <div>
                <label className="nf-label">一致レコード（{searchResult.matched.length} / {searchResult.total} 件）</label>
                {searchResult.matched.length === 0 ? (
                  <p className="nf-text-11 nf-text-muted nf-mb-0">一致するレコードはありません。</p>
                ) : (
                  <div className="nf-card">
                    <pre style={codeBlockStyle}>{searchResult.matched.map((e) => `#${e["No."] ?? "?"} · ${e.id}`).join("\n")}</pre>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ===== 置換（テンプレート）モード ===== */}
        {mode === "template" && (
          <>
            {renderSharedPickers()}
            <div>
              <label className="nf-label">テンプレート（{"{{...}}"} で view 式を埋め込み）</label>
              <textarea
                ref={templateRef}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={5}
                style={{ ...monoTextareaStyle, minHeight: "100px" }}
                placeholder={"例: {{ [氏名] }} 様（{{ YEAR([受付日]) }}年度）\nフルクエリ: {{SELECT [氏名] FROM _form LIMIT 1}}"}
              />
              <FieldInsertPicker
                paths={sharedFieldPaths}
                onInsert={(p) => insertAtCursor(templateRef.current, template, `{{ [${p}] }}`, setTemplate)}
              />
              <div style={{ marginTop: "6px" }}>
                <button type="button" onClick={handleRunTemplate} disabled={tplRunning} className="nf-btn-outline">
                  {tplRunning ? "実行中..." : "置換実行"}
                </button>
              </div>
              <SnippetBar
                category="template"
                snippets={snippets}
                currentBody={template}
                onSave={handleSaveSnippet}
                onLoad={setTemplate}
              />
              <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
                フルクエリトークン（{"{{SELECT ...}}"}）も解決されます。現フォームは <code>FROM _form</code>（アンダースコア付き。<code>form</code> ではありません）。
                参照できるのは自フォームと formLink で紐づく子フォームのみです。
              </p>
            </div>
            {tplError && <p className="nf-text-warning">{tplError}</p>}
            {tplDone && !tplError && (
              <div>
                <label className="nf-label">置換結果</label>
                <div className="nf-card">
                  <pre style={codeBlockStyle}>{tplResult || "（空文字）"}</pre>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== 式評価モード ===== */}
        {mode === "expression" && (
          <>
            {renderSharedPickers()}
            <div>
              <label className="nf-label">式（単一の alasql 式・SELECT/FROM は不要）</label>
              <textarea
                ref={exprRef}
                value={expr}
                onChange={(e) => setExpr(e.target.value)}
                rows={3}
                style={{ ...monoTextareaStyle, minHeight: "60px" }}
                placeholder={"例: YEAR([受付日]) = 2025\n計算: [単価] * [数量]\n表示条件: [区] = '中央区' AND [年齢] >= 20"}
              />
              <FieldInsertPicker
                paths={sharedFieldPaths}
                onInsert={(p) => insertAtCursor(exprRef.current, expr, `[${p}]`, setExpr)}
              />
              <div style={{ marginTop: "6px" }}>
                <button type="button" onClick={handleRunExpression} disabled={exprRunning} className="nf-btn-outline">
                  {exprRunning ? "実行中..." : "式評価"}
                </button>
              </div>
              <SnippetBar
                category="expression"
                snippets={snippets}
                currentBody={expr}
                onSave={handleSaveSnippet}
                onLoad={setExpr}
              />
              <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
                表示条件 / 計算フィールド / テーブルスタイル行セレクタで使う単一式を評価します。置換（{"{{...}}"}）と違い、式本体だけを書きます。
              </p>
            </div>
            {exprError && <p className="nf-text-warning">{exprError}</p>}
            {exprResult && !exprError && (
              <div>
                <label className="nf-label">評価結果（型: {exprResult.type}）</label>
                <div className="nf-card">
                  <pre style={codeBlockStyle}>{
                    exprResult.type === "boolean"
                      ? (exprResult.value ? "true（真）" : "false（偽）")
                      : (exprResult.value === null ? "null（空）" : JSON.stringify(exprResult.value, null, 2))
                  }</pre>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== 外部アクション モード ===== */}
        {mode === "externalAction" && (
          <>
            {renderSharedPickers()}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <label style={{ fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={whAdminGate}
                  onChange={(e) => setWhAdminGate(e.target.checked)}
                  style={{ marginRight: "4px" }}
                />
                管理者ゲート（storage ブロックを含める）
              </label>
              <button type="button" onClick={handleRunExternalAction} disabled={whRunning} className="nf-btn-outline">
                {whRunning ? "生成中..." : "ペイロード生成"}
              </button>
            </div>
            {whWarn && <p className="nf-text-11 nf-text-muted nf-mb-0">{whWarn}</p>}
            {whError && <p className="nf-text-warning">{whError}</p>}
            {externalActionJson && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <label className="nf-label nf-mb-0">POST ペイロード（payload フィールドの JSON）</label>
                  <button type="button" className="nf-btn-outline" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={copyExternalActionJson}>
                    {copied ? "コピー済" : "コピー"}
                  </button>
                </div>
                <div className="nf-card">
                  <pre style={codeBlockStyle}>{externalActionJson}</pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
