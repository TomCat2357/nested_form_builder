import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useSetSelection } from "../../app/hooks/useSetSelection.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { pad2 } from "../../utils/dateTime.js";
import { dataStore } from "../../app/state/dataStore.js";
import { getRecordsFromCache, upsertRecordInCache } from "../../app/state/recordsMemoryStore.js";
import { normalizeSchemaIDs } from "../../core/schema.js";
import {
  backfillComputedFieldValues,
  recomputeComputedFieldValues,
  buildComputedFieldPathsById,
  collectSubstitutionChildFormRefs,
} from "../../core/computedFields.js";
import { traverseSchema } from "../../core/schemaUtils.js";
import { FULL_QUERY_SUBST_RE } from "../../core/constants.js";
import { prefetchQueryTokens } from "../../utils/tokenReplacer.js";
import { subscribeChildFormChange } from "../../app/state/childRecordsMemoryStore.js";
import { evaluateCacheForRecords } from "../../app/state/cachePolicy.js";
import { buildBackfilledRecord, selectFreshComputedWritePaths, rememberComputedWrites } from "./backfillComputedValues.js";
import { buildSearchTableLayout, buildHeaderRowsLayout, createHitExcerptColumn, createBaseColumns, buildSimpleSearchColumns, DEFAULT_HIT_COLUMN_MIN_WIDTH } from "./searchTable.js";
import { buildExportTableData } from "./searchExport.js";
import { hasScriptRun, listRecordsByPids } from "../../services/gasClient.js";
import { buildChildFormUrl, buildSharedFormUrl, buildSharedRecordUrl } from "../../utils/formShareUrl.js";
import { buildChildDataObject, distributeChildRecordsByPid, getChildFormCached_, collectFormLinkFields } from "../preview/childFormData.js";
import {
  computeRowValues,
  compareByColumn,
  parseSearchCellDisplayLimit,
} from "./searchTableValues.js";
import { buildRowHitExcerpts } from "./searchQueryEngine.js";
import { buildSearchExpression } from "./searchExpressionBuilder.js";
import { entriesToViewTableRows } from "../analytics/entriesToViewRows.js";
import { filterRowsByExpr } from "../analytics/analyticsAlaSql.js";
import { runSearchSelect } from "../analytics/analyticsStore.js";
import { SQL_MODE_RE } from "./searchSyntaxPreprocessor.js";
import {
  buildFieldPathsMap,
  resolveOmitEmptyRowsOnPrint,
} from "../preview/printDocument.js";
import { createExcelBlob, getThemeColors } from "../../utils/excelExport.js";
import { blobToBase64 } from "../../utils/fileEncoding.js";
import { useEntries } from "./useEntries.js";
import { saveExcelToDrive } from "../../services/gasClient.js";
import { useSearchDisplayOverrides } from "./useSearchDisplayOverrides.js";
import { DEFAULT_THEME, applyThemeWithFallback } from "../../app/theme/theme.js";
import { DEFAULT_PAGE_SIZE } from "../../core/constants.js";
import { useSearchPagePrintActions } from "./useSearchPagePrintActions.js";

export const buildInitialSort = (params) => {
  const raw = params.get("sort");
  if (!raw) return { key: "No.", order: "desc" };
  const lastColonIndex = raw.lastIndexOf(":");
  if (lastColonIndex === -1) return { key: raw, order: "desc" };
  const key = raw.slice(0, lastColonIndex);
  const order = raw.slice(lastColonIndex + 1);
  return { key: key || "No.", order: order === "asc" ? "asc" : "desc" };
};

export function useSearchPageState({
  searchParams,
  setSearchParams,
  location,
  navigate,
  showAlert,
  showOutputAlert,
  userEmail,
  scopedFormId,
  getFormById,
  forms,
  settings,
  childPid = "",
}) {
  const queryFormId = (searchParams.get("form") || "").trim();
  const effectiveFormId = queryFormId || scopedFormId;
  const isScopedByAuth = scopedFormId !== "";
  const currentSearchUrl = `${location.pathname}${location.search}`;

  const deleteDialog = useConfirmDialog({ entryIds: [] });
  const undeleteDialog = useConfirmDialog({ entryIds: [] });
  const { selected: selectedEntries, toggle: toggleSelectEntry, selectAll: selectAllEntriesRaw, clear: clearSelectedEntries } = useSetSelection();
  const [exporting, setExporting] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const displaySettingsDialog = useConfirmDialog();

  const form = useMemo(() => (effectiveFormId ? getFormById(effectiveFormId) : null), [effectiveFormId, getFormById]);
  const normalizedSchema = useMemo(() => normalizeSchemaIDs(form?.schema || []), [form?.schema]);
  const omitEmptyRowsOnPrint = resolveOmitEmptyRowsOnPrint(form?.settings);
  const fieldPaths = useMemo(() => buildFieldPathsMap(normalizedSchema), [normalizedSchema]);
  const activeSort = useMemo(() => buildInitialSort(searchParams), [searchParams]);
  const query = searchParams.get("q") || "";
  // URL ?page の要求値。下限のみ 1 で丸める。実際に使う page は sortedEntries 確定後に
  // totalPages で上限クランプする（pageSize 増加などで総ページ数が減ったとき範囲外に残るのを防ぐ）。
  const requestedPage = Math.max(1, Number(searchParams.get("page") || 1));
  const { overrides: searchOverrides, updateOverride } = useSearchDisplayOverrides(effectiveFormId);
  // pageSize の意味論:
  //   負値（典型: -1）→ 全件表示。Number.MAX_SAFE_INTEGER で表現することで
  //     pagedEntries の slice(0, +N) が全件返却、totalPages も 1 に収束する。
  //     Infinity は Math.ceil(N / Infinity) = 0 を踏むので避ける。
  //   0 / NaN / 未設定 → DEFAULT_PAGE_SIZE にフォールバック（従来挙動）。
  //   正の有限数 → そのまま採用。
  const rawPageSize = Number(searchOverrides?.pageSize ?? form?.settings?.pageSize ?? settings?.pageSize);
  const PAGE_SIZE = rawPageSize < 0
    ? Number.MAX_SAFE_INTEGER
    : (rawPageSize > 0 ? rawPageSize : DEFAULT_PAGE_SIZE);
  const TABLE_MAX_WIDTH = Number(searchOverrides?.searchTableMaxWidth) || Number(form?.settings?.searchTableMaxWidth) || Number(settings?.searchTableMaxWidth) || null;
  const cellDisplayLimit =
    parseSearchCellDisplayLimit(searchOverrides?.searchCellMaxChars) ||
    parseSearchCellDisplayLimit(form?.settings?.searchCellMaxChars) ||
    parseSearchCellDisplayLimit(settings?.searchCellMaxChars) ||
    null;
  // 検索ヒット箇所列の最小幅。override → フォーム設定 → グローバル設定 の順に解決し、
  // いずれも未設定なら既定値を使う。0 / 負値 / NaN は既定値にフォールバック。
  const HIT_COLUMN_MIN_WIDTH = (() => {
    const candidates = [
      searchOverrides?.searchHitColumnMinWidth,
      form?.settings?.searchHitColumnMinWidth,
      settings?.searchHitColumnMinWidth,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return DEFAULT_HIT_COLUMN_MIN_WIDTH;
  })();

  const {
    entries: allEntries,
    loading,
    backgroundLoading,
    waitingForLock,
    useCache,
    lastSyncedAt,
    hasUnsynced,
    unsyncedCount,
    cacheDisabled,
    forceRefreshAll,
    reloadFromCache,
  } = useEntries({
    formId: effectiveFormId,
    form,
    locationKey: location.key,
    locationState: location.state,
    showAlert,
  });

  // 子フォームのオーバーレイ文脈では、開いた元の親レコード id（childPid）に等しい行だけを対象にする。
  // レコードキャッシュは formId 単位で共有され他 pid の行も載りうる（SWR の即時表示・差分同期の
  // 残留）ため、サーバ側 pid フィルタに加えてここでも絞り込み、表示・検索・ソート・出力の全段を
  // pid スコープに揃える。childPid が空（通常ページ）なら従来どおり全件。
  const entries = useMemo(() => {
    if (!childPid) return allEntries;
    return allEntries.filter((entry) => String(entry?.pid ?? "") === childPid);
  }, [allEntries, childPid]);

  const { columns, headerRows } = useMemo(
    () => buildSearchTableLayout(form, {
      includeOperations: false,
    }),
    [form],
  );

  // 検索スコープ用の列集合。メタ4項目（No./ID/作成日時/最終更新日時）は表示・非表示に
  // 関わらず常に検索対象とするため、表示列に含まれていない非表示メタ列を補って superset を作る。
  // 値計算 / 簡易検索 / ヒット抜粋 / ソートにはこちらを使い、表示は素の columns（show 設定で
  // フィルタ済み）を使う。
  const searchColumns = useMemo(() => {
    const presentKeys = new Set(columns.map((column) => column.key));
    const hiddenMeta = createBaseColumns().filter((column) => !presentKeys.has(column.key));
    return hiddenMeta.length ? [...columns, ...hiddenMeta] : columns;
  }, [columns]);

  // 簡易検索（プレフィックスなし）の式生成専用の列集合。表示列に設定していない
  // 深いネストフィールドにも裸単語 / `列名:値`（リーフ名）が届くよう、スキーマ全
  // フィールドぶんを補った superset。評価行（entriesToViewTableRows）は元々全
  // フィールドのキーを持つので、ここで列側を揃えるとフルパス指定でなくてもヒットする。
  // 値計算 / ソート / ヒット抜粋には searchColumns を使い続ける。
  const simpleSearchColumns = useMemo(
    () => buildSimpleSearchColumns(form, searchColumns),
    [form, searchColumns],
  );

  // 簡易検索モード（キーワード入力あり かつ SQL モードでない）のときだけ
  // 「検索ヒット箇所」列を最左に挿入する。
  const hitColumnActive = useMemo(() => {
    const keyword = (query || "").trim();
    return Boolean(keyword) && !SQL_MODE_RE.test(keyword);
  }, [query]);

  // 表示専用の列構成。値計算 / 検索 / ソートには素の columns を使い続け、
  // ヒット列はレンダリング用のこちらにのみ含める。
  const displayColumns = useMemo(
    () => (hitColumnActive ? [createHitExcerptColumn(), ...columns] : columns),
    [hitColumnActive, columns],
  );
  const displayHeaderRows = useMemo(
    () => (hitColumnActive ? buildHeaderRowsLayout(displayColumns) : headerRows),
    [hitColumnActive, displayColumns, headerRows],
  );

  const handleSearchChange = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("q", value);
    else next.delete("q");
    next.set("page", "1");
    setSearchParams(next);
  };

  const handleSortToggle = (key) => {
    const next = new URLSearchParams(searchParams);
    const current = buildInitialSort(next);
    const order = current.key === key ? (current.order === "desc" ? "asc" : "desc") : "desc";
    next.set("sort", `${key}:${order}`);
    setSearchParams(next);
  };

  const handlePageChange = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
  };

  useEffect(() => {
    if (!form) return;
    const theme = form?.settings?.theme || DEFAULT_THEME;
    void applyThemeWithFallback(theme, { persist: false });
  }, [form?.id, form?.settings?.theme, settings?.theme]);

  const isDeletedEntry = useCallback((entry) => Boolean(entry?.deletedAtUnixMs || entry?.deletedAt), []);

  const hasComputedFields = useMemo(
    () => Object.keys(buildComputedFieldPathsById(normalizedSchema)).length > 0,
    [normalizedSchema],
  );

  // ============================================================================
  // 子フォーム参照の置換（substitution）を一覧で解決・表示・保存する。
  //   - CHILD_FORM_*(`項目名`) 置換: listRecordsByPids でバッチ取得した子データを childFormMeta
  //     として注入して評価。
  //   - full-query({{SELECT}}) 置換: 子フォーム定義を warm し、行ごとに prefetchQueryTokens で解決。
  //   解決値は recomputeComputedFieldValues で entry.data へ反映し、buildBackfilledRecord 経由で
  //   キャッシュ→次回同期でシートへ永続化する（要望1）。未解決の間はセルに「読込中…」を出す（要望2）。
  //   state はここで宣言し、取得/解決の effect は下方（pagedEntries 確定後）に置く。
  // ============================================================================
  const substitutionChildRefs = useMemo(
    () => collectSubstitutionChildFormRefs(normalizedSchema),
    [normalizedSchema],
  );
  const hasFullQuerySubstitution = substitutionChildRefs.hasFullQuery;
  const hasDependentSubstitutions = Object.keys(substitutionChildRefs.byFieldId).length > 0;

  // 外部アクション payload 用 = 全 formLink。ただし一覧では eager 取得せず、外部アクション送信時に
  // resolveSearchChildFormsForRows で対象行ぶんだけ on-demand バッチ取得する（下記）。
  const externalActionChildFormFields = useMemo(
    () => collectFormLinkFields(normalizedSchema),
    [normalizedSchema],
  );
  // eager バッチ取得の対象は「表示に必要な子データ」だけ＝置換参照＋full-query。
  // （full-query があるときは参照先を静的特定できないため全 formLink）。外部アクション 専用の formLink は
  // 一覧表示中は取得しない（送信時に on-demand 取得するためコストを払わない）。
  const childDataTargetFields = useMemo(() => {
    const refIds = new Set(substitutionChildRefs.childFormIds);
    const wantAll = substitutionChildRefs.hasFullQuery;
    if (!wantAll && refIds.size === 0) return [];
    return collectFormLinkFields(normalizedSchema).filter(
      (f) => wantAll || refIds.has(f.childFormId),
    );
  }, [normalizedSchema, substitutionChildRefs]);

  // 「別フォームを開く（formLink）」を表示列に設定した項目。一覧の各行で、このレコードに
  // 紐づく子フォームの件数バッジを出すために pid ごとの件数を取得する（表示にした時だけ）。
  const displayedFormLinkFields = useMemo(
    () => collectFormLinkFields(normalizedSchema).filter((f) => f.isDisplayed),
    [normalizedSchema],
  );

  // 取得結果: { [fieldId]: { path, byPid: { [pid]: 合成オブジェクト } } }
  const [searchChildDataByField, setSearchChildDataByField] = useState({});
  const [childDataReady, setChildDataReady] = useState(false);
  const [childFetchEpoch, setChildFetchEpoch] = useState(0);
  // 表示列にした formLink の件数: { [path]: { [pid]: number } }。
  // 列（buildSearchColumns）は素の form.schema 由来で field id が空になりうる（GAS 保存で
  // strip）ため、列とのキーは論理パス（ラベル由来で両者一致）で突き合わせる。
  const [formLinkCountsByPath, setFormLinkCountsByPath] = useState({});
  const [formLinkCountEpoch, setFormLinkCountEpoch] = useState(0);
  // full-query 用
  const [searchChildForms, setSearchChildForms] = useState([]);
  const [fullQueryReady, setFullQueryReady] = useState(() => !substitutionChildRefs.hasFullQuery);
  const [queryTokensByEntry, setQueryTokensByEntry] = useState(() => new Map());
  const [fullQueryAllRows, setFullQueryAllRows] = useState(false);
  const [recomputePending, setRecomputePending] = useState(false);
  // full-query を行ごとに 1 回だけ prefetch するための解決済み id 集合（再 prefetch を避ける）。
  const resolvedQueryIdsRef = useRef(new Set());
  // 置換再計算の書き戻し冪等化メモ: `${recordId} ${path}` → 直近に書き戻した計算値。
  // 同じ計算値を毎サイクル打ち直して「未アップロード」警告が永久に再武装するのを防ぐ（churn 対策）。
  const writtenComputedValuesRef = useRef(new Map());

  // pid → { [fieldId]: 子フォーム合成オブジェクト }（tokenContext.childFormMeta 形）。
  const getChildFormMetaForPid = useCallback((pid) => {
    const key = String(pid || "");
    const out = {};
    if (!key) return out;
    for (const field of childDataTargetFields) {
      const fieldData = searchChildDataByField[field.id];
      const obj = fieldData && fieldData.byPid ? fieldData.byPid[key] : null;
      if (obj) out[field.id] = obj;
    }
    return out;
  }, [childDataTargetFields, searchChildDataByField]);

  // 外部アクション送信時に呼ぶ on-demand リゾルバ。対象行ぶんの子データを
  // 子フォームごとに 1 回の listRecordsByPids でバッチ取得し、entries と同順の childFormsByRow
  // （各行 = 子フォーム合成オブジェクト配列）を返す。一覧表示中は取得しないことでコストを払わない。
  // 表示用に既に eager 取得済み（searchChildDataByField）の子フォームはそれを再利用し、再取得しない。
  const resolveSearchChildFormsForRows = useCallback(async (entries) => {
    const rows = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (rows.length === 0 || externalActionChildFormFields.length === 0) return null;
    const pids = Array.from(new Set(rows.map((e) => String(e && e.id != null ? e.id : "")).filter(Boolean)));
    if (pids.length === 0) return null;
    const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
    const canFetch = typeof listRecordsByPids === "function" && hasScriptRun();
    // fieldId → { [pid]: 合成オブジェクト }
    const byField = {};
    // fieldId → 子フォームの保存先スプレッドシート ID（リレーで choju へ動的受け渡し）。
    const ssByField = {};
    const childSpreadsheetIdOf = (cf) => (
      cf && cf.settings && typeof cf.settings.spreadsheetId === "string" ? cf.settings.spreadsheetId : ""
    );
    for (const field of externalActionChildFormFields) {
      // 表示用に eager 取得済みなら再利用（同じ子フォーム・同じ pid 集合を満たす範囲で）。
      const cached = searchChildDataByField[field.id];
      if (cached && cached.byPid && pids.every((pid) => cached.byPid[pid] !== undefined)) {
        byField[field.id] = cached.byPid;
        // 子 SS は form 定義から（getChildFormCached_ は promise キャッシュで安価）。
        try { ssByField[field.id] = childSpreadsheetIdOf(await getChildFormCached_(field.childFormId)); }
        catch (_e) { ssByField[field.id] = ""; }
        continue;
      }
      if (!canFetch) continue;
      try {
        const [childForm, records] = await Promise.all([
          getChildFormCached_(field.childFormId),
          listRecordsByPids({ formId: field.childFormId, pids }),
        ]);
        ssByField[field.id] = childSpreadsheetIdOf(childForm);
        const childSchema = childForm && childForm.schema ? childForm.schema : [];
        const grouped = distributeChildRecordsByPid(records);
        const byPid = {};
        grouped.forEach((recs, pid) => {
          byPid[pid] = buildChildDataObject({
            childFormId: field.childFormId,
            childFormName: field.childFormName,
            childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, pid),
            childSchema,
            records: recs,
          });
        });
        byField[field.id] = byPid;
      } catch (_e) {
        // 取得失敗時はその子フォームを欠落させる（無言）。
      }
    }
    return rows.map((entry) => {
      const key = String(entry && entry.id != null ? entry.id : "");
      const out = [];
      for (const field of externalActionChildFormFields) {
        const byPid = byField[field.id];
        const obj = byPid ? byPid[key] : null;
        if (obj) out.push({ fieldPath: field.path, ...obj, childSpreadsheetId: ssByField[field.id] || "" });
      }
      return out;
    });
  }, [externalActionChildFormFields, searchChildDataByField]);

  // 「子データ / full-query 依存の置換」が出る表示列（読込中・再計算の対象判定に使う）。
  const dependentSubstColumns = useMemo(() => {
    if (!hasDependentSubstitutions) return [];
    const byFieldId = substitutionChildRefs.byFieldId;
    const pathsById = buildComputedFieldPathsById(normalizedSchema);
    const out = [];
    for (const col of displayColumns) {
      if (!col || !col.path) continue;
      let info = col.fieldId && byFieldId[col.fieldId] ? byFieldId[col.fieldId] : null;
      if (!info) {
        for (const fid of Object.keys(byFieldId)) {
          if (pathsById[fid] === col.path) { info = byFieldId[fid]; break; }
        }
      }
      if (!info) continue;
      out.push({
        columnKey: col.key,
        path: col.path,
        needsChild: info.childFormIds.length > 0,
        needsFullQuery: info.hasFullQuery === true,
      });
    }
    return out;
  }, [hasDependentSubstitutions, substitutionChildRefs, normalizedSchema, displayColumns]);

  // 同期バックフィル（processedEntries）が補完してよい置換 fieldId。子データ/full-query 依存の
  // 置換は子データ無しで誤った値（例: 件数 0）を書かないよう除外し、recompute effect に任せる。
  const sameRecordBackfillFieldIds = useMemo(() => {
    if (!hasDependentSubstitutions) return null; // 除外対象なし = 全置換（従来挙動）
    const all = Object.keys(buildComputedFieldPathsById(normalizedSchema));
    const dependent = new Set(Object.keys(substitutionChildRefs.byFieldId));
    return all.filter((fid) => !dependent.has(fid));
  }, [hasDependentSubstitutions, normalizedSchema, substitutionChildRefs]);

  const processedEntries = useMemo(() => {
    return entries.map((entry) => {
      if (!hasComputedFields) {
        return {
          entry,
          values: computeRowValues(entry, searchColumns),
          backfillResult: null,
          originalEntry: entry,
        };
      }
      const backfillResult = backfillComputedFieldValues(normalizedSchema, entry?.data, undefined, sameRecordBackfillFieldIds);
      const effectiveEntry = backfillResult.changed ? { ...entry, data: backfillResult.data } : entry;
      return {
        entry: effectiveEntry,
        values: computeRowValues(effectiveEntry, searchColumns),
        backfillResult,
        originalEntry: entry,
      };
    });
  }, [entries, searchColumns, normalizedSchema, hasComputedFields, sameRecordBackfillFieldIds]);

  const recordsNeedingBackfill = useMemo(
    () => processedEntries.filter((row) => row.backfillResult?.changed),
    [processedEntries],
  );

  useCancellable(async (isCancelled) => {
    if (!effectiveFormId) return;
    if (recordsNeedingBackfill.length === 0) return;
    try {
      const { headerMatrix, schemaHash } = await getRecordsFromCache(effectiveFormId);
      const now = Date.now();
      for (const row of recordsNeedingBackfill) {
        if (isCancelled()) return;
        const next = buildBackfilledRecord(row.originalEntry, row.backfillResult, { now, userEmail });
        if (!next) continue;
        await upsertRecordInCache(effectiveFormId, next, { headerMatrix, schemaHash });
      }
      if (!isCancelled()) await reloadFromCache();
    } catch (error) {
      console.warn("[SearchPage] computed backfill failed:", error);
    }
  }, [effectiveFormId, recordsNeedingBackfill, userEmail, reloadFromCache]);

  const baseFilteredEntries = useMemo(() => {
    let base = processedEntries;
    if (!showDeleted) {
      base = base.filter((row) => !isDeletedEntry(row.entry));
    }
    return base;
  }, [processedEntries, showDeleted, isDeletedEntry]);

  const [filteredEntries, setFilteredEntries] = useState(baseFilteredEntries);
  const [filterError, setFilterError] = useState(null);

  // 検索は data/view の区別なく、唯一のデータ形式である view 形式の行に対して評価する。
  // entriesToViewTableRows は選択肢ラベル文字列（複数値は codec 連結）を持ち、各行に row.id を持つ。
  const searchTableRows = useMemo(() => {
    if (!form) return [];
    const entriesArr = baseFilteredEntries.map((row) => row.entry);
    return entriesToViewTableRows(entriesArr, form);
  }, [form, baseFilteredEntries]);

  // 簡易検索は view 形式行をそのまま評価する。簡易モードの式は検索対象外メタ列
  // （createdBy / modifiedBy / deletedAt / deletedBy）を参照しないため、行側から落とす必要はない。
  const simpleSearchRows = searchTableRows;

  useCancellable(async (isCancelled) => {
    const keyword = (query || "").trim();
    if (!keyword) {
      setFilterError(null);
      setFilteredEntries(baseFilteredEntries);
      return;
    }
    // SQL モード（先頭 SELECT）: 検索バーに最上位 SQL を直接書く。
    // 現フォームを `_form`、本文にサブクエリ / 別フォーム参照を書ける。結果行の現フォーム id 集合で
    // baseFilteredEntries を絞り込む（id を持たない射影 / 別フォームの id は一致せず 0 件）。
    if (SQL_MODE_RE.test(keyword)) {
      setFilterError(null);
      try {
        const res = await runSearchSelect(keyword, { forms, defaultFormId: effectiveFormId });
        if (isCancelled()) return;
        if (!res.ok) {
          setFilterError("検索エラー: " + (res.error || "SQL を評価できませんでした"));
          setFilteredEntries(baseFilteredEntries);
          return;
        }
        const idSet = new Set();
        for (const r of (res.rows || [])) {
          if (r && r.id != null && r.id !== "") idSet.add(r.id);
        }
        setFilteredEntries(baseFilteredEntries.filter((row) => idSet.has(row.entry?.id)));
      } catch (err) {
        if (isCancelled()) return;
        setFilterError("検索エラー: " + (err && err.message ? err.message : String(err)));
        setFilteredEntries(baseFilteredEntries);
      }
      return;
    }
    // 簡易検索モード: searchSimpleTranslate が正規表現 / 複数値集合分解などを WHERE 式へ翻訳し、
    // filterRowsByExpr（SELECT * FROM ? WHERE <expr>）で評価する。
    // 列はスキーマ全フィールドを横断できる superset（simpleSearchColumns）を使う。
    const { expr, errors } = buildSearchExpression(keyword, simpleSearchColumns);
    if (errors && errors.length > 0) {
      setFilteredEntries([]);
      setFilterError(errors.join(", "));
      return;
    }
    if (!expr) {
      // 式が空になるのは空 AST（例 "()"）のみ。全件一致として全件表示する。
      setFilterError(null);
      setFilteredEntries(baseFilteredEntries);
      return;
    }
    setFilterError(null);
    try {
      // expr は searchSimpleTranslate が columnToSafeKey（= headerKeyToAlaSqlKey）で
      // 既に safe key 化済み。ここで preprocessAlaSqlExpression を再適用すると、ラベルに
      // "/" を含む列の safe key（"継続\/完結" → "継続/完結"）に headerKeyToAlaSqlKey が
      // 二重適用され "継続__完結" に化けて view 行のキー（"継続/完結"）と食い違う（0 件回帰）。
      // 生成式はバッククォート/UDF 解決済みなので、そのまま filterRowsByExpr へ渡す。
      const res = await filterRowsByExpr(simpleSearchRows, expr);
      if (isCancelled()) return;
      if (!res.ok) {
        setFilterError("検索エラー: " + (res.error || "式を評価できませんでした"));
        setFilteredEntries(baseFilteredEntries);
        return;
      }
      const idSet = new Set();
      for (const r of res.rows) {
        if (r && r.id != null && r.id !== "") idSet.add(r.id);
      }
      setFilteredEntries(baseFilteredEntries.filter((row) => idSet.has(row.entry?.id)));
    } catch (err) {
      if (isCancelled()) return;
      setFilterError("検索エラー: " + (err && err.message ? err.message : String(err)));
      setFilteredEntries(baseFilteredEntries);
    }
  }, [baseFilteredEntries, searchColumns, simpleSearchColumns, query, searchTableRows, simpleSearchRows, form, forms, effectiveFormId]);

  const sortedEntries = useMemo(() => {
    const list = filteredEntries.slice();
    const targetColumn = searchColumns.find((column) => column.key === activeSort.key && column.sortable !== false);
    if (targetColumn) {
      list.sort((a, b) => compareByColumn(a, b, targetColumn, activeSort.order));
    }
    return list;
  }, [filteredEntries, searchColumns, activeSort]);

  // ページ番号は要求値（URL ?page）を totalPages で上限クランプする。
  // 表示件数を増やす等で総ページ数が減ったとき、URL に残った大きい page が範囲外
  // （空ページ・「21 - 2 件」「2 / 1」のような表示）になる回帰を防ぐ。
  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const selectedPrintableRows = useMemo(
    () => sortedEntries.filter((row) => selectedEntries.has(row.entry.id)),
    [selectedEntries, sortedEntries],
  );

  // 外部アクション / 検索結果の出力で使う対象行: チェックがあればその行だけ、なければ全行。
  // (印刷は selectedPrintableRows のまま = 選択必須で例外)
  const outputTargetRows = useMemo(
    () => (selectedEntries.size > 0 ? selectedPrintableRows : sortedEntries),
    [selectedEntries, selectedPrintableRows, sortedEntries],
  );

  // 子データの取得・解決 effect は displayPagedEntries の後（下方）に置く。
  // state / getter（searchChildDataByField / getChildFormMetaForPid / resolveSearchChildFormsForRows）は
  // 上部の「子フォーム参照の置換」ブロックで宣言済み。

  const pagedEntries = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedEntries.slice(start, start + PAGE_SIZE);
  }, [sortedEntries, page, PAGE_SIZE]);

  // 表示中ページの各行にヒット抜粋を付与（最大 PAGE_SIZE 件のみ計算）。
  // さらに「子データ / full-query 依存の置換セルが 空 かつ 未解決」の列キーを pendingCellKeys に
  // 集めて行へ付与する（SearchTable が該当セルに「読込中…」を出す）。
  const displayPagedEntries = useMemo(() => {
    const withHits = hitColumnActive
      ? pagedEntries.map((row) => ({
          ...row,
          hitExcerpts: buildRowHitExcerpts(row, searchColumns, query, { cellDisplayLimit }),
        }))
      : pagedEntries;
    if (dependentSubstColumns.length === 0) return withHits;
    return withHits.map((row) => {
      const data = row.entry?.data || {};
      const id = String(row.entry?.id || "");
      const pending = new Set();
      for (const c of dependentSubstColumns) {
        const stored = data[c.path];
        if (!(stored === undefined || stored === null || stored === "")) continue;
        let ready = true;
        if (c.needsChild && !childDataReady) ready = false;
        if (c.needsFullQuery && !(fullQueryReady && queryTokensByEntry.has(id))) ready = false;
        if (recomputePending && (c.needsChild || c.needsFullQuery)) ready = false;
        if (!ready) pending.add(c.columnKey);
      }
      return pending.size > 0 ? { ...row, pendingCellKeys: pending } : row;
    });
  }, [hitColumnActive, pagedEntries, searchColumns, query, cellDisplayLimit, dependentSubstColumns, childDataReady, fullQueryReady, queryTokensByEntry, recomputePending]);

  // ---- 子データ取得 / full-query 解決 / 置換値の再計算・書き戻し（state は上部で宣言済み）----
  // 取得対象 pid（表示・非表示問わず読み込み済みの全レコード）。順序非依存の安定シグネチャ。
  const childFetchPids = useMemo(
    () => Array.from(new Set(entries.map((e) => e?.id).filter(Boolean))),
    [entries],
  );
  const childFetchPidSignature = useMemo(() => [...childFetchPids].sort().join(","), [childFetchPids]);
  const childTargetSignature = childDataTargetFields.map((f) => `${f.id}:${f.childFormId}`).join("|");

  // 子フォームごとに 1 回だけ listRecordsByPids でバッチ取得し、pid 分配して合成オブジェクトを作る。
  useCancellable(async (isCancelled) => {
    setChildDataReady(false);
    setSearchChildDataByField({});
    if (childDataTargetFields.length === 0) { if (!isCancelled()) setChildDataReady(true); return; }
    if (typeof listRecordsByPids !== "function" || !hasScriptRun()) { if (!isCancelled()) setChildDataReady(true); return; }
    if (childFetchPids.length === 0) { if (!isCancelled()) setChildDataReady(true); return; }
    const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
    for (const field of childDataTargetFields) {
      try {
        const [childForm, records] = await Promise.all([
          getChildFormCached_(field.childFormId),
          listRecordsByPids({ formId: field.childFormId, pids: childFetchPids }),
        ]);
        if (isCancelled()) return;
        const childSchema = childForm && childForm.schema ? childForm.schema : [];
        const grouped = distributeChildRecordsByPid(records);
        const byPid = {};
        grouped.forEach((recs, pid) => {
          byPid[pid] = buildChildDataObject({
            childFormId: field.childFormId,
            childFormName: field.childFormName,
            childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, pid),
            childSchema,
            records: recs,
          });
        });
        setSearchChildDataByField((prev) => ({ ...prev, [field.id]: { path: field.path, byPid } }));
      } catch (_e) {
        // 取得失敗時はその子フォームのデータを出さない（無言）。
      }
    }
    if (!isCancelled()) setChildDataReady(true);
  }, [childTargetSignature, childFetchPidSignature, childFetchEpoch]);

  // T1: 子フォームのレコード変化（オーバーレイ編集・複製）を購読し、子データを再取得する。
  // 再取得 → searchChildDataByField 変化 → 再計算 effect が走り、該当親レコードだけ差分更新される。
  useEffect(() => {
    const targetIds = new Set(childDataTargetFields.map((f) => f.childFormId));
    if (targetIds.size === 0) return undefined;
    const unsubscribe = subscribeChildFormChange((changedChildFormId) => {
      if (targetIds.has(changedChildFormId)) setChildFetchEpoch((n) => n + 1);
    });
    return unsubscribe;
  }, [childTargetSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // 表示列にした formLink の件数を pid ごとに取得する。子フォームごとに 1 回の
  // listRecordsByPids でまとめて取得し、pid 分配して件数だけ集計する（レコード詳細画面の
  // 件数バッジと同じく listRecordsByPids の返却件数 = ソフトデリート除外済みに揃う）。
  const displayedFormLinkSignature = displayedFormLinkFields
    .map((f) => `${f.path}:${f.childFormId}`)
    .join("|");
  useCancellable(async (isCancelled) => {
    setFormLinkCountsByPath({});
    if (displayedFormLinkFields.length === 0) return;
    if (typeof listRecordsByPids !== "function" || !hasScriptRun()) return;
    if (childFetchPids.length === 0) return;
    for (const field of displayedFormLinkFields) {
      try {
        const records = await listRecordsByPids({ formId: field.childFormId, pids: childFetchPids });
        if (isCancelled()) return;
        const grouped = distributeChildRecordsByPid(records);
        const byPid = {};
        grouped.forEach((recs, pid) => { byPid[pid] = recs.length; });
        setFormLinkCountsByPath((prev) => ({ ...prev, [field.path]: byPid }));
      } catch (_e) {
        // 取得失敗時はその項目の件数を出さない（無言）。
      }
    }
  }, [displayedFormLinkSignature, childFetchPidSignature, formLinkCountEpoch]);

  // 表示列 formLink の子フォーム変化（オーバーレイ編集・複製）を購読し、件数を再取得する。
  useEffect(() => {
    const targetIds = new Set(displayedFormLinkFields.map((f) => f.childFormId));
    if (targetIds.size === 0) return undefined;
    const unsubscribe = subscribeChildFormChange((changedChildFormId) => {
      if (targetIds.has(changedChildFormId)) setFormLinkCountEpoch((n) => n + 1);
    });
    return unsubscribe;
  }, [displayedFormLinkSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // full-query 置換のための子フォーム定義ロード + 子レコード warm（runFullQuery が getRecordsFromCache から読む）。
  useCancellable(async (isCancelled) => {
    if (!hasFullQuerySubstitution || !effectiveFormId || !hasScriptRun()) {
      if (!isCancelled()) setFullQueryReady(true);
      return;
    }
    setFullQueryReady(false);
    const linkFields = collectFormLinkFields(normalizedSchema);
    const defResults = await Promise.all(
      linkFields.map((f) => getChildFormCached_(f.childFormId).catch(() => null)),
    );
    if (isCancelled()) return;
    const defs = defResults.filter((d) => d && d.id);
    await Promise.all(linkFields.map(async (f) => {
      try {
        const cache = await getRecordsFromCache(f.childFormId);
        const { shouldSync } = evaluateCacheForRecords({
          lastSyncedAt: cache.lastSyncedAt,
          hasData: Array.isArray(cache.entries) && cache.entries.length > 0,
          forceSync: false,
        });
        if (shouldSync) await dataStore.listEntries(f.childFormId);
      } catch (_e) { /* warm 失敗は無言 */ }
    }));
    if (isCancelled()) return;
    setSearchChildForms(defs);
    setFullQueryReady(true);
  }, [hasFullQuerySubstitution, effectiveFormId, childTargetSignature, childFetchEpoch]);

  const searchForms = useMemo(
    () => [
      { id: effectiveFormId || "", name: form?.settings?.formTitle || effectiveFormId || "", schema: normalizedSchema },
      ...searchChildForms,
    ],
    [effectiveFormId, form?.settings?.formTitle, normalizedSchema, searchChildForms],
  );

  const fullQueryTemplates = useMemo(() => {
    if (!hasFullQuerySubstitution) return "";
    const tpls = [];
    traverseSchema(normalizedSchema, (field) => {
      if (field?.type === "substitution" && typeof field?.templateText === "string" && FULL_QUERY_SUBST_RE.test(field.templateText)) {
        tpls.push(field.templateText);
      }
    });
    return tpls.join("\n");
  }, [normalizedSchema, hasFullQuerySubstitution]);

  // T3: テンプレ（=スキーマ）/ フォームが変わったら full-query 解決値を破棄して取り直す。
  // 破棄後は recompute 側が再解決トークンで full-query 値を上書きする（可視行から順次）。
  useEffect(() => {
    resolvedQueryIdsRef.current = new Set();
    writtenComputedValuesRef.current = new Map();
    setQueryTokensByEntry((prev) => (prev.size === 0 ? prev : new Map()));
  }, [fullQueryTemplates, effectiveFormId]);

  // 行ごとに full-query を prefetch（重い AlaSQL）。通常は可視ページ、更新ボタン後は全行。
  const fullQueryTargetIds = useMemo(() => {
    if (!hasFullQuerySubstitution) return [];
    const rows = fullQueryAllRows ? sortedEntries : pagedEntries;
    return rows.map((r) => r.entry?.id).filter(Boolean);
  }, [hasFullQuerySubstitution, fullQueryAllRows, sortedEntries, pagedEntries]);
  const fullQueryTargetSignature = fullQueryTargetIds.join(",");

  useCancellable(async (isCancelled) => {
    if (!hasFullQuerySubstitution || !fullQueryReady || !fullQueryTemplates) return;
    const pendingIds = fullQueryTargetIds.filter((id) => !resolvedQueryIdsRef.current.has(id));
    if (pendingIds.length === 0) return;
    const resolved = new Map();
    for (const id of pendingIds) {
      if (isCancelled()) return;
      try {
        const map = await prefetchQueryTokens(fullQueryTemplates, {
          recordId: id,
          formId: effectiveFormId,
          forms: searchForms,
        });
        resolved.set(id, map);
        resolvedQueryIdsRef.current.add(id);
      } catch (_e) { /* prefetch 失敗は無言（未解決のまま） */ }
    }
    if (isCancelled() || resolved.size === 0) return;
    setQueryTokensByEntry((prev) => {
      const merged = new Map(prev);
      for (const [k, v] of resolved) merged.set(k, v);
      return merged;
    });
  }, [hasFullQuerySubstitution, fullQueryReady, fullQueryTemplates, fullQueryTargetSignature, searchForms, childFetchEpoch]);

  // 子データ / full-query が揃った行の置換を再計算し、値が変わったものだけキャッシュへ書き戻す。
  // 空の評価値は据え置く（recomputeComputedFieldValues の仕様）ので、full-query 未解決行は child 系
  // のみ反映され、トークン到着後の再走で full-query 値も反映される。書き戻しは modifiedAt を更新し
  // （既存踏襲）、次回同期でシートへ永続化される（要望1）。差分が無ければ書き戻さない（冪等）。
  useCancellable(async (isCancelled) => {
    if (!effectiveFormId || !hasDependentSubstitutions || !childDataReady) return;
    const rows = sortedEntries;
    if (rows.length === 0) return;
    const baseUrl = (typeof window !== "undefined")
      ? (window.__GAS_WEBAPP_URL__ || window.location.origin)
      : "";
    const formUrl = buildSharedFormUrl(baseUrl, effectiveFormId);
    // 上書き対象は「子データ / full-query 依存の置換」だけに限定（同一レコード参照・NOW() 系の churn を防ぐ）。
    // full-query 依存の置換はトークン未取得の行では書かない（"件数: " のような部分解決値の保存を防ぐ）。
    const byFieldId = substitutionChildRefs.byFieldId;
    const childOnlyFieldIds = Object.keys(byFieldId).filter((fid) => !byFieldId[fid].hasFullQuery);
    const fullQueryFieldIds = Object.keys(byFieldId).filter((fid) => byFieldId[fid].hasFullQuery);
    setRecomputePending(true);
    try {
      const { headerMatrix, schemaHash } = await getRecordsFromCache(effectiveFormId);
      const now = Date.now();
      let wroteAny = false;
      for (const row of rows) {
        if (isCancelled()) return;
        const entry = row.originalEntry || row.entry;
        const id = String(entry?.id || "");
        if (!id || isDeletedEntry(entry)) continue;
        const queryTokenValues = queryTokensByEntry.get(id);
        const writeFieldIds = queryTokenValues
          ? [...childOnlyFieldIds, ...fullQueryFieldIds]
          : childOnlyFieldIds;
        if (writeFieldIds.length === 0) continue;
        const tokenContext = {
          fieldPaths,
          childFormMeta: getChildFormMetaForPid(id),
          queryTokenValues: queryTokenValues || undefined,
          queryTokensReady: Boolean(queryTokenValues),
          recordId: id,
          formId: effectiveFormId,
          formUrl,
          recordUrl: buildSharedRecordUrl(baseUrl, effectiveFormId, id),
        };
        const result = recomputeComputedFieldValues(normalizedSchema, entry.data, tokenContext, writeFieldIds);
        if (!result.changed) continue;
        // 冪等ガード: 既に同じ計算値を書き戻した path しか無ければ再打刻しない（churn 防止）。
        // 往復後の保存値が一致しないケースでも、同じ値の再打刻＝「未アップロード」再武装を抑止する。
        const memo = writtenComputedValuesRef.current;
        const freshPaths = selectFreshComputedWritePaths(id, result.changedPaths, result.data, memo);
        if (freshPaths.length === 0) continue;
        const next = buildBackfilledRecord(entry, result, { now, userEmail });
        if (!next) continue;
        await upsertRecordInCache(effectiveFormId, next, { headerMatrix, schemaHash });
        rememberComputedWrites(id, result.changedPaths, result.data, memo);
        wroteAny = true;
      }
      if (!isCancelled() && wroteAny) await reloadFromCache();
    } catch (error) {
      console.warn("[SearchPage] substitution recompute failed:", error);
    } finally {
      if (!isCancelled()) setRecomputePending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFormId, normalizedSchema, sortedEntries, searchChildDataByField, queryTokensByEntry, childDataReady, fullQueryReady]);

  // T2: 更新（再同期）ボタン。通常のリフレッシュに加え、子データ再取得 + full-query 全行の
  // 再解決（解決済みキャッシュを破棄）を促し、全件の置換値を再計算させる。
  const handleForceRefreshAll = useCallback(() => {
    resolvedQueryIdsRef.current = new Set();
    setQueryTokensByEntry((prev) => (prev.size === 0 ? prev : new Map()));
    setChildFetchEpoch((n) => n + 1);
    setFullQueryAllRows(true);
    forceRefreshAll();
  }, [forceRefreshAll]);

  const totalEntries = sortedEntries.length;
  const startIndex = totalEntries === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIndex = totalEntries === 0 ? 0 : Math.min(page * PAGE_SIZE, totalEntries);

  const badge = useMemo(() => {
    if (loading || backgroundLoading || waitingForLock) return { label: "読み取り中...", variant: "loading" };
    return { label: "検索画面", variant: "view" };
  }, [loading, backgroundLoading, waitingForLock]);

  const {
    isCreatingPrintDocument,
    handleCellAction,
    handleCreatePrintDocument,
  } = useSearchPagePrintActions({
    form,
    normalizedSchema,
    fieldPaths,
    omitEmptyRowsOnPrint,
    selectedPrintableRows,
    showAlert,
    showOutputAlert,
  });

  const handleRowClick = (entryId) => {
    if (!effectiveFormId) return;
    const entryIds = sortedEntries.map((row) => row.entry.id);
    navigate(`/form/${effectiveFormId}/entry/${entryId}`, {
      state: { from: currentSearchUrl, entryIds },
    });
  };

  const handleCreateNew = () => {
    if (!effectiveFormId) return;
    navigate(`/form/${effectiveFormId}/new`, {
      state: {
        from: currentSearchUrl,
      },
    });
  };

  const handleOpenFormConfig = () => {
    if (!effectiveFormId) return;
    navigate(`/forms/${encodeURIComponent(effectiveFormId)}/settings`, {
      state: { from: currentSearchUrl },
    });
  };

  const handleBackToMain = () => {
    if (location.state?.from) {
      navigate(location.state.from);
      return;
    }
    navigate("/");
  };

  const selectAllEntries = (checked) => {
    if (checked) selectAllEntriesRaw(pagedEntries.map((item) => item.entry.id));
    else clearSelectedEntries();
  };

  const allSelectedAreDeleted = useMemo(() => {
    if (selectedEntries.size === 0) return false;
    const selectedRows = sortedEntries.filter((row) => selectedEntries.has(row.entry.id));
    if (selectedRows.length === 0) return false;
    return selectedRows.every((row) => isDeletedEntry(row.entry));
  }, [selectedEntries, sortedEntries, isDeletedEntry]);

  const handleDeleteSelected = () => {
    if (selectedEntries.size === 0) {
      showAlert("削除する項目を選択してください。");
      return;
    }
    deleteDialog.open({ entryIds: Array.from(selectedEntries) });
  };

  const handleUndeleteSelected = () => {
    if (selectedEntries.size === 0) return;
    undeleteDialog.open({ entryIds: Array.from(selectedEntries) });
  };

  const handleExportResults = useCallback(async () => {
    if (outputTargetRows.length === 0) return;
    setExporting(true);
    try {
      const exportingEntries = outputTargetRows.map((row) => row.entry);
      const exportTable = buildExportTableData({ form, entries: exportingEntries });
      const themeColors = getThemeColors();

      const now = new Date();
      const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
      const filename = `検索結果_${form?.settings?.formTitle || form?.id || "form"}_${timestamp}.xlsx`;

      const blob = await createExcelBlob(exportTable, themeColors);
      const base64data = await blobToBase64(blob);

      const result = await saveExcelToDrive({ filename, base64: base64data });

      showOutputAlert({ message: "マイドライブにエクセルファイルを保存しました。", url: result.fileUrl, linkLabel: "ファイルを開く" });
    } catch (err) {
      console.error("[SearchPage] excel export failed:", err);
      showAlert(`出力に失敗しました: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }, [form, outputTargetRows, showAlert]);

  const confirmDelete = useCallback(async () => {
    if (!effectiveFormId || deleteDialog.state.entryIds.length === 0) return;
    const targetIds = [...deleteDialog.state.entryIds];
    deleteDialog.reset();
    for (const entryId of targetIds) {
      await dataStore.deleteEntry(effectiveFormId, entryId, { deletedBy: userEmail || "" });
    }
    await reloadFromCache();
    forceRefreshAll();
    clearSelectedEntries();
  }, [effectiveFormId, forceRefreshAll, reloadFromCache, deleteDialog.state.entryIds, userEmail]);

  const confirmUndelete = useCallback(async () => {
    if (!effectiveFormId || undeleteDialog.state.entryIds.length === 0) return;
    const targetIds = [...undeleteDialog.state.entryIds];
    undeleteDialog.reset();
    for (const entryId of targetIds) {
      await dataStore.undeleteEntry(effectiveFormId, entryId, { modifiedBy: userEmail || "" });
    }
    await reloadFromCache();
    forceRefreshAll();
    clearSelectedEntries();
  }, [effectiveFormId, forceRefreshAll, reloadFromCache, undeleteDialog.state.entryIds, userEmail]);

  return {
    // Derived IDs / flags
    effectiveFormId,
    isScopedByAuth,

    // Form data
    form,

    // State
    showDeleteConfirm: deleteDialog.state,
    setShowDeleteConfirm: deleteDialog.setState,
    showUndeleteConfirm: undeleteDialog.state,
    setShowUndeleteConfirm: undeleteDialog.setState,
    selectedEntries,
    exporting,
    isCreatingPrintDocument,
    showDeleted,
    setShowDeleted,
    displaySettingsDialog,

    // Search / pagination
    query,
    page,
    activeSort,
    searchOverrides,
    updateOverride,
    PAGE_SIZE,
    TABLE_MAX_WIDTH,
    cellDisplayLimit,
    HIT_COLUMN_MIN_WIDTH,

    // Entries data
    entries,
    columns,
    headerRows,
    displayColumns,
    displayHeaderRows,
    displayPagedEntries,
    formLinkChildCounts: formLinkCountsByPath,
    loading,
    backgroundLoading,
    waitingForLock,
    useCache,
    lastSyncedAt,
    hasUnsynced,
    unsyncedCount,
    cacheDisabled,
    // 更新ボタンは T2（全件再計算）も起動するラッパを公開する。内部の削除/復元は raw を使う。
    forceRefreshAll: handleForceRefreshAll,
    sortedEntries,
    outputTargetRows,
    resolveSearchChildFormsForRows,
    pagedEntries,
    filterError,

    // Pagination computed
    totalPages,
    totalEntries,
    startIndex,
    endIndex,

    // UI
    badge,
    allSelectedAreDeleted,
    isDeletedEntry,

    // Callbacks
    handleSearchChange,
    handleSortToggle,
    handlePageChange,
    handleRowClick,
    handleCreateNew,
    handleOpenFormConfig,
    handleBackToMain,
    toggleSelectEntry,
    selectAllEntries,
    handleDeleteSelected,
    handleUndeleteSelected,
    handleExportResults,
    handleCellAction,
    handleCreatePrintDocument,
    confirmDelete,
    confirmUndelete,
  };
}
