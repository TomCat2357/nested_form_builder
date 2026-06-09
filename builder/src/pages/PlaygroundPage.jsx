import React, { useMemo, useState } from "react";
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
import { resolveTemplateAsync } from "../features/expression/templateEvaluator.js";
import { prefetchQueryTokens } from "../utils/tokenReplacer.js";
import { restoreResponsesFromData } from "../utils/responses.js";
import { buildRecordItems } from "../features/preview/printDocument.js";
import { buildExternalActionPayload } from "../utils/externalActionPost.js";
import { collectFormLinkFields, getChildFormCached_, buildChildDataObject } from "../features/preview/childFormData.js";
import { hasScriptRun, listRecordsByPids } from "../services/gasClient.js";
import { buildChildFormUrl } from "../utils/formShareUrl.js";
import { normalizeSchemaIDs } from "../core/schema.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";

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

export default function PlaygroundPage() {
  const { isAdmin, userEmail } = useAuth();
  const { forms } = useAppData();
  const activeForms = useMemo(() => (forms || []).filter((f) => !f.archived), [forms]);

  const [mode, setMode] = useState("question"); // "question" | "template" | "webhook"

  // --- Question モード（SQL → 表）---
  const [qFormId, setQFormId] = useState("");
  const [qSql, setQSql] = useState("");
  const [qResult, setQResult] = useState(null);
  const [qError, setQError] = useState(null);
  const [qRunning, setQRunning] = useState(false);

  // --- template / webhook 共有（フォーム + レコード選択）---
  const [selectedFormId, setSelectedFormId] = useState("");
  const [fullForm, setFullForm] = useState(null); // schema を含む完全なフォーム（getForm で取得・正規化済み）
  const [entries, setEntries] = useState([]);
  const [entriesError, setEntriesError] = useState(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState("");

  // --- template モード ---
  const [template, setTemplate] = useState("");
  const [tplResult, setTplResult] = useState("");
  const [tplDone, setTplDone] = useState(false);
  const [tplError, setTplError] = useState(null);
  const [tplRunning, setTplRunning] = useState(false);

  // --- webhook モード ---
  const [webhookJson, setWebhookJson] = useState("");
  const [whWarn, setWhWarn] = useState("");
  const [whError, setWhError] = useState(null);
  const [whRunning, setWhRunning] = useState(false);
  const [whAdminGate, setWhAdminGate] = useState(true);
  const [copied, setCopied] = useState(false);

  // selectedFormId が変わるたびに、完全フォーム（schema）と実レコードをロードする。
  useCancellable(async (isCancelled) => {
    setSelectedRecordId("");
    setFullForm(null);
    setEntries([]);
    setEntriesError(null);
    setTplResult("");
    setTplDone(false);
    setWebhookJson("");
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

  const handleRunWebhook = async () => {
    setWhError(null);
    setWebhookJson("");
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

      // 子フォーム（formLink）を実 Webhook と同じく record.items 列へ完全展開する。
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
      const payload = buildExternalActionPayload({
        context: "record",
        formId: fullForm.id,
        formName: fullForm.settings?.formTitle || "",
        base: { record },
        storageFields: {
          spreadsheetId: normalizeSpreadsheetId(fullForm.settings?.spreadsheetId || ""),
          sheetName: fullForm.settings?.sheetName || "Data",
          driveFileUrl: fullForm.driveFileUrl || "",
          userEmail,
        },
        gate: { adminOnly: whAdminGate, isAdmin },
      });
      setWebhookJson(JSON.stringify(payload, null, 2));
      setWhWarn(warn);
    } catch (err) {
      setWhError(err?.message || String(err));
    } finally {
      setWhRunning(false);
    }
  };

  const copyWebhookJson = () => {
    if (!webhookJson) return;
    navigator.clipboard.writeText(webhookJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  if (!isAdmin) return null;

  // template / webhook 共有のフォーム + レコードピッカー。
  const sharedPickers = (
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
    </div>
  );

  return (
    <AppLayout title="Playground" fallbackPath="/admin" backHidden={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p className="nf-text-11 nf-text-muted nf-mb-0">
          Question の SQL・置換テンプレート・Webhook の POST ペイロードを、実データに対してその場で試せます（管理者専用）。
        </p>

        <fieldset style={{ border: "1px solid var(--nf-border)", borderRadius: "4px", padding: "8px 12px", margin: 0 }}>
          <legend style={{ fontSize: "12px", padding: "0 6px" }}>モード</legend>
          {[
            ["question", "Question（SQL → 表）"],
            ["template", "置換（テンプレート → 文字列）"],
            ["webhook", "Webhook（POST ペイロード）"],
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
                value={qSql}
                onChange={(e) => setQSql(e.target.value)}
                rows={8}
                style={{ ...monoTextareaStyle, minHeight: "160px" }}
                placeholder={"例: SELECT [基本情報|区], COUNT(*) AS count FROM [data] GROUP BY [基本情報|区]\n他フォーム参照: SELECT * FROM [フォーム名] AS f\nバッククォートも使用可: SELECT * FROM `フォーム名`"}
              />
              <div style={{ marginTop: "6px" }}>
                <button type="button" onClick={handleRunQuestion} disabled={qRunning} className="nf-btn-outline">
                  {qRunning ? "実行中..." : "クエリ実行"}
                </button>
              </div>
            </div>
            {qError && <p className="nf-text-warning">{qError}</p>}
            {qResult?.ok && (
              <ResultTable rows={qResult.rows} columns={qResult.columns} sql={qSql} />
            )}
          </>
        )}

        {/* ===== 置換（テンプレート）モード ===== */}
        {mode === "template" && (
          <>
            {sharedPickers}
            <div>
              <label className="nf-label">テンプレート（{"{{...}}"} で view 式を埋め込み）</label>
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={5}
                style={{ ...monoTextareaStyle, minHeight: "100px" }}
                placeholder={"例: {{ [氏名] }} 様（{{ YEAR([受付日]) }}年度）\nフルクエリ: {{SELECT [氏名] FROM _form LIMIT 1}}"}
              />
              <div style={{ marginTop: "6px" }}>
                <button type="button" onClick={handleRunTemplate} disabled={tplRunning} className="nf-btn-outline">
                  {tplRunning ? "実行中..." : "置換実行"}
                </button>
              </div>
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

        {/* ===== Webhook モード ===== */}
        {mode === "webhook" && (
          <>
            {sharedPickers}
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
              <button type="button" onClick={handleRunWebhook} disabled={whRunning} className="nf-btn-outline">
                {whRunning ? "生成中..." : "ペイロード生成"}
              </button>
            </div>
            {whWarn && <p className="nf-text-11 nf-text-muted nf-mb-0">{whWarn}</p>}
            {whError && <p className="nf-text-warning">{whError}</p>}
            {webhookJson && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <label className="nf-label nf-mb-0">POST ペイロード（payload フィールドの JSON）</label>
                  <button type="button" className="nf-btn-outline" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={copyWebhookJson}>
                    {copied ? "コピー済" : "コピー"}
                  </button>
                </div>
                <div className="nf-card">
                  <pre style={codeBlockStyle}>{webhookJson}</pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
