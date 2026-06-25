import { ensureArray } from "../../utils/arrays.js";
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../../utils/errorMessage.js";
import { collectResponses, sortResponses, buildDataValueMap } from "../../core/collect.js";
import { computeSchemaHash } from "../../core/schema.js";
import { collectValidationErrors, formatValidationErrors } from "../../core/validate.js";
import * as gasClientModule from "../../services/gasClient.js";
const { submitResponses, hasScriptRun, countRecordsByPid, listRecordsByPids, getUrlPid, sendExternalAction } = gasClientModule;
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { styles as s } from "../editor/styles.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { collectDefaultNowResponses } from "../../utils/responses.js";
import { genRecordId } from "../../core/ids.js";
import { resolveTemplateTokens, resolveTemplateTokensAsync, precompileTemplateTokens, prefetchQueryTokens, resolveQueryTokensInTemplate } from "../../utils/tokenReplacer.js";
import { extractReservedRefs } from "../../features/expression/templateEvaluator.js";
import { evaluateAllComputedFields } from "../../core/computedFields.js";
import { buildLiveViewRow } from "../analytics/entriesToViewRows.js";
import {
  buildPrintDocumentPayload,
  buildFieldPathsMap,
  buildFieldValuesMap,
  collectFileUploadMeta,
  collectExternalActionFiles,
  formatRecordMetaDateTime,
  buildRecordItems,
} from "./printDocument.js";
import { normalizeExternalAction } from "../../core/schema.js";
import { isValidExternalActionUrl, buildSpreadsheetUrl, hasBlockedSensitiveRefs } from "../../utils/externalActionUrl.js";
import { buildExternalActionPayload, interpretExternalActionResponse } from "../../utils/externalActionPost.js";
import {
  normalizePrintTemplateAction,
  resolveEffectivePrintTemplateFileNameTemplate,
  resolveStandardPrintTemplateId,
} from "../../utils/printTemplateAction.js";
import {
  validateOutputAction,
  downloadPdfFromBase64,
} from "../../utils/recordOutputActions.js";
import {
  appendDriveFileId,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";
import { collectFileUploadFields } from "../../core/schema.js";
import { buildSharedFormUrl, buildSharedRecordUrl, buildChildFormUrl } from "../../utils/formShareUrl.js";
import { buildChildDataObject, getChildFormCached_, collectFormLinkFields } from "./childFormData.js";
import {
  getChildRecordsFromCache,
  saveChildDataToCache,
  saveChildCountToCache,
  subscribeChildFormChange,
} from "../../app/state/childRecordsMemoryStore.js";
import { evaluateCacheForRecords } from "../../app/state/cachePolicy.js";
import { dataStore } from "../../app/state/dataStore.js";
import { getRecordsFromCache } from "../../app/state/recordsMemoryStore.js";
import { useFormContext, useChildForm } from "../../app/state/formContext.jsx";
import { RendererRecursive } from "./FieldRenderer.jsx";
import { collectTemplateTexts, detectFullQuerySubstitution } from "./previewTemplates.js";

// 入力中の full-query 置換を再解決するデバウンス（ms）。検索バーと同じ既定値。
const LIVE_QUERY_DEBOUNCE_MS = 300;

const PreviewPage = React.forwardRef(function PreviewPage(
  {
    schema,
    responses,
    setResponses,
    settings = {},
    showOutputJson = true,
    onSave,
    onRecordNoChange,
    saveButtonLabel = "回答保存",
    showSaveButton = true,
    readOnly = false,
    isAdmin = true,
    entryId,
    onChildFormJump,
    driveFolderStates,
    onFieldDriveFolderStateChange,
    canDeleteDriveFolder,
    onDeleteDriveFolder,
  },
  ref,
) {
  const { showAlert, showOutputAlert } = useAlert();
  const initialRecordId = settings.recordId;
  const recordIdRef = useRef(initialRecordId || genRecordId());
  const currentUserName = typeof settings.userName === "string" ? settings.userName : "";
  const currentUserEmail = typeof settings.userEmail === "string" ? settings.userEmail : "";
  const currentUserAffiliation = typeof settings.userAffiliation === "string" ? settings.userAffiliation : "";
  const currentUserTitle = typeof settings.userTitle === "string" ? settings.userTitle : "";
  const currentUserPhone = typeof settings.userPhone === "string" ? settings.userPhone : "";
  const defaultNowMap = useMemo(
    () => collectDefaultNowResponses(schema, new Date(), {
      userName: currentUserName,
      userEmail: currentUserEmail,
      userAffiliation: currentUserAffiliation,
      userTitle: currentUserTitle,
      userPhone: currentUserPhone,
    }),
    [schema, currentUserName, currentUserEmail, currentUserAffiliation, currentUserTitle, currentUserPhone],
  );

  useEffect(() => {
    if (initialRecordId && recordIdRef.current !== initialRecordId) {
      recordIdRef.current = initialRecordId;
    }
  }, [initialRecordId]);

  useEffect(() => {
    // 既往データ編集時は自動初期値設定をスキップ
    if (settings.recordId) return;

    if (!defaultNowMap || Object.keys(defaultNowMap).length === 0) return;
    setResponses((prev) => {
      const current = prev || {};
      let changed = false;
      const next = { ...current };
      Object.keys(defaultNowMap).forEach((key) => {
        const currentValue = next[key];
        if (currentValue === undefined || currentValue === null || currentValue === "") {
          next[key] = defaultNowMap[key];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [defaultNowMap, setResponses, settings.recordId]);

  const formTitle = settings.formTitle || "受付フォーム";
  const modifiedAtDisplay = formatRecordMetaDateTime(settings.modifiedAtUnixMs ?? settings.modifiedAt);
  const fieldPaths = useMemo(() => buildFieldPathsMap(schema), [schema]);
  const fieldValues = useMemo(() => buildFieldValuesMap(schema, responses), [schema, responses]);
  const dataValueMap = useMemo(() => buildDataValueMap(schema, responses), [schema, responses]);

  const gasClientRef = useRef(gasClientModule);

  // 子フォーム文脈（オーバーレイ or URL に form+pid あり）では formLink ボタンを出さない＝
  // 子フォームからさらに子フォームを作らせない。オーバーレイ表示時は FormContext が
  // inChildContext を供給する。Provider 配下でない（＝新規タブで開いた既存経路）ときは
  // 従来どおり URL グローバル getUrlPid() にフォールバックする。
  const formContext = useFormContext();
  const inChildContext = useMemo(
    () => (formContext
      ? !!formContext.inChildContext
      : !!(typeof getUrlPid === "function" && getUrlPid())),
    [formContext],
  );
  // 「別フォームを開く（formLink）」をオーバーレイで開くためのトリガ。
  const { openChildForm } = useChildForm();

  // schema 内の formLink フィールド（childFormId あり）を収集する。各々について子フォームの
  // 子レコード件数（pid == このレコード id）をバッジ表示する。
  // 全 formLink 項目について子レコード全件を 外部アクション/印刷へ渡すため常に詳細ロードする。
  const formLinkFields = useMemo(() => collectFormLinkFields(schema), [schema]);

  const [formLinkChildCounts, setFormLinkChildCounts] = useState({});
  // 子フォームの合成オブジェクト（fieldId → { childFormId, childFormName, childFormUrl, count, records }）。
  // 全 formLink 項目を詰める。外部アクション 送信・印刷・プレビューの CHILD_FORM_* で参照。
  const [formLinkChildData, setFormLinkChildData] = useState({});
  // 件数取得は「既存レコード（保存済み id あり）」かつ GAS 利用可かつ子フォーム文脈でない場合のみ。
  // 子レコード / 件数は childRecordsMemoryStore に SWR キャッシュする：キャッシュがあれば即表示し、
  // しきい値（cachePolicy）に従って裏で再検証。新鮮なら GAS 往復しない。
  // 親の同期（modifiedAtUnixMs 変化）時は forceSync で必ずハード再取得する。失敗は無言。
  const formLinkSignature = formLinkFields
    .map((f) => `${f.id}:${f.childFormId}`)
    .join("|");
  // 別レコードを開いた瞬間の残像を防ぐためのリセット判定 / 親再同期の強制更新判定に使う。
  const prevChildRecordIdRef = useRef(null);
  const prevChildModifiedAtRef = useRef(undefined);
  useCancellable(async (isCancelled) => {
    const recordId = recordIdRef.current;
    // レコードが切り替わった時だけ state をリセット（同一レコードの再評価ではキャッシュ即表示を維持）。
    const recordChanged = prevChildRecordIdRef.current !== recordId;
    // 同一レコードで modifiedAtUnixMs が変わった＝親が再同期された → 子データを強制再取得。
    const parentChanged =
      !recordChanged &&
      prevChildModifiedAtRef.current !== undefined &&
      prevChildModifiedAtRef.current !== settings.modifiedAtUnixMs;
    prevChildRecordIdRef.current = recordId;
    prevChildModifiedAtRef.current = settings.modifiedAtUnixMs;
    if (recordChanged) {
      setFormLinkChildCounts({});
      setFormLinkChildData({});
    }
    if (inChildContext) return;
    if (!settings.recordId || !recordId) return;
    if (!hasScriptRun()) return;
    if (formLinkFields.length === 0) return;
    const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";

    // 1 項目ぶんの取得 → state 反映 → キャッシュ書き戻し。shouldSync は await、shouldBackground は
    // fire-and-forget で使う。state 反映はキャンセルガードするが、キャッシュ書き戻しは常に行う。
    const fetchField = async (field) => {
      if (typeof listRecordsByPids === "function") {
        // 子レコード全件 + 子 schema を取得し、合成オブジェクトを組む（件数も records から導出）。
        // 全 formLink で常に詳細を取得し、外部アクション/印刷の items 列へ展開できるようにする。
        const [childForm, records] = await Promise.all([
          getChildFormCached_(field.childFormId),
          listRecordsByPids({ formId: field.childFormId, pids: [recordId] }),
        ]);
        const childObj = buildChildDataObject({
          childFormId: field.childFormId,
          childFormName: field.childFormName,
          childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, recordId),
          childSchema: childForm && childForm.schema ? childForm.schema : [],
          records,
        });
        await saveChildDataToCache(field.childFormId, recordId, childObj);
        if (isCancelled()) return;
        setFormLinkChildData((prev) => ({ ...prev, [field.id]: childObj }));
        setFormLinkChildCounts((prev) => ({ ...prev, [field.id]: childObj.count }));
      } else if (typeof countRecordsByPid === "function") {
        const count = await countRecordsByPid({ formId: field.childFormId, pid: recordId });
        await saveChildCountToCache(field.childFormId, recordId, count);
        if (isCancelled()) return;
        setFormLinkChildCounts((prev) => ({ ...prev, [field.id]: count }));
      }
    };

    for (const field of formLinkFields) {
      try {
        const kind = "detail";
        const cached = await getChildRecordsFromCache(field.childFormId, recordId, { kind });
        if (isCancelled()) return;
        // キャッシュ即表示（cache-first）。
        if (cached.hasData) {
          if (kind === "detail" && cached.childData) {
            setFormLinkChildData((prev) => ({ ...prev, [field.id]: cached.childData }));
          }
          setFormLinkChildCounts((prev) => ({ ...prev, [field.id]: cached.count }));
        }
        const { shouldSync, shouldBackground } = evaluateCacheForRecords({
          lastSyncedAt: cached.lastSyncedAt,
          hasData: cached.hasData,
          forceSync: parentChanged,
        });
        if (shouldSync) {
          await fetchField(field);
          if (isCancelled()) return;
        } else if (shouldBackground) {
          // 裏で再検証（非ブロッキング）。内部で isCancelled ガード済み。
          fetchField(field).catch(() => {});
        }
      } catch (_e) {
        // 取得失敗時はバッジ / 子データを出さない（無言）。
      }
    }
  }, [settings.recordId, settings.modifiedAtUnixMs, formLinkSignature, inChildContext]);

  // 全 formLink 項目の { fieldId: 合成オブジェクト } マップ。外部アクション の record.items 展開・
  // 印刷 payload（items 展開 + driveSettings.childFormMeta）・プレビュー row 注入で共有する。
  const childFormMeta = useMemo(() => {
    const out = {};
    for (const field of formLinkFields) {
      const obj = formLinkChildData[field.id];
      if (obj) out[field.id] = obj;
    }
    return out;
  }, [formLinkFields, formLinkChildData]);

  const folderUrlsByField = useMemo(() => {
    const out = {};
    for (const [fid, st] of Object.entries(driveFolderStates || {})) {
      const url = (st?.resolvedUrl || st?.inputUrl || "").trim();
      if (url) out[fid] = url;
    }
    return out;
  }, [driveFolderStates]);
  const folderNamesByField = useMemo(() => {
    const out = {};
    for (const [fid, st] of Object.entries(driveFolderStates || {})) {
      const folderName = (st?.folderName || "").trim();
      if (folderName) out[fid] = folderName;
    }
    return out;
  }, [driveFolderStates]);
  const fileUploadMeta = useMemo(
    () => collectFileUploadMeta(schema, { responses: responses || {}, folderUrlsByField, folderNamesByField }),
    [schema, responses, folderUrlsByField, folderNamesByField],
  );
  const driveSettings = useMemo(() => ({
    formId: settings.formId || "",
    recordId: recordIdRef.current,
    responses: responses || {},
    fieldPaths,
    fieldValues,
    dataValues: dataValueMap,
    fileUploadMeta,
    childFormMeta,
  }), [settings.formId, responses, fieldPaths, fieldValues, dataValueMap, fileUploadMeta, childFormMeta]);

  const primaryFileUploadFieldId = useMemo(
    () => collectFileUploadFields(schema)[0]?.id || "",
    [schema],
  );
  const primaryDriveFolderState = useMemo(
    () => normalizeDriveFolderState((driveFolderStates || {})[primaryFileUploadFieldId]),
    [driveFolderStates, primaryFileUploadFieldId],
  );

  // full-query トークン（`{{SELECT ...}}`）の解決値 Map<fullToken, string>。
  // 非同期 prefetch（下の effect）が用意し、tokenContext 経由で同期 resolve に供給する。
  const [queryTokenValues, setQueryTokenValues] = useState(() => new Map());
  // full-query prefetch が現在の schema/formId/entryId について完了したか。
  // 完了前（=false）は同期 resolve が prefetch を先回りするのが正常なので、未解決トークンを
  // 警告しない。完了後（=true）に欠落していれば本物の配線/SQL バグとして警告する。
  const [queryTokensReady, setQueryTokensReady] = useState(false);

  const tokenContext = useMemo(() => {
    const baseUrl = typeof window !== "undefined" ? (window.__GAS_WEBAPP_URL__ || window.location.origin) : "";
    const formId = settings.formId || "";
    const recordId = recordIdRef.current;
    const formUrl = buildSharedFormUrl(baseUrl, formId);
    const recordUrl = buildSharedRecordUrl(baseUrl, formId, recordId);
    return { now: new Date(), formId, formName: formTitle, recordId, formUrl, recordUrl, fieldPaths, fileUploadMeta, childFormMeta, queryTokenValues, queryTokensReady };
  }, [settings.formId, formTitle, fieldPaths, fileUploadMeta, childFormMeta, queryTokenValues, queryTokensReady]);

  // schema 内のテンプレ式を一括 precompile して同期 resolveTemplateTokens を保証する。
  // alasql のロード + コンパイルが完了したら epoch を進めて再評価をトリガする。
  const [precompileEpoch, setPrecompileEpoch] = useState(0);
  useCancellable(async (isCancelled) => {
    const templates = collectTemplateTexts(schema, { includePrintFileName: true });
    if (templates.length === 0) return;
    try {
      await Promise.all(templates.map((t) => precompileTemplateTokens(t)));
      if (!isCancelled()) setPrecompileEpoch((e) => e + 1);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[PreviewPage] template precompile failed", err && err.message);
      }
    }
  }, [schema]);

  // 置換 full-query を「入力中のライブ値」で解決するための補助。full-query 置換が無ければ
  // 何もしない（高速パス）。
  const hasFullQuerySubstitution = useMemo(() => detectFullQuerySubstitution(schema), [schema]);

  // full-query 解決へ渡すフォーム群。現フォーム（プレビュー中のライブ schema）に加え、
  // 「別フォームを開く（formLink）」で紐づく子フォーム定義を含める。これにより full-query で
  // `FROM [子フォーム名]` ＋ `pid` 結合の参照が解決できる。現フォームはネットワーク／IndexedDB を
  // 介さずライブ schema をそのまま使うので、`_form` 基底テーブルの view 変換と buildLiveRow の
  // ライブ行が同一 schema で整形される（未保存スキーマ変更のプレビューでも行形状が一致）。
  // 子フォーム定義は下の effect が getChildFormCached_ で取得して childForms に積む（取得不可なら現フォームのみ）。
  const [childForms, setChildForms] = useState([]);
  // 子フォーム定義のロード＋レコード warming 完了を prefetch effect へ伝えるための epoch。
  const [childReadyEpoch, setChildReadyEpoch] = useState(0);
  // formLink 子フォームの初回ロード（定義取得＋レコード warm）が完了したか。full-query 置換が
  // 別フォームを参照していて未ロードの過渡状態（runFullQuery が「未定義のフォーム」を返す間）を、
  // substitution の「読込中…」表示に使う。完了後に空のままなら本物の欠落として空表示へ落ちる。
  const [childFormsReady, setChildFormsReady] = useState(false);
  const previewForms = useMemo(
    () => [{ id: settings.formId || "", name: formTitle, schema }, ...childForms],
    [settings.formId, formTitle, schema, childForms],
  );

  // 「別フォームを開く（formLink）」で紐づく子フォームを、親フォームと同様に扱う:
  //   (1) フォーム定義（schema）を取得して previewForms に載せる（full-query の FROM／pid 解決用）
  //   (2) レコードを recordsMemoryStore に常駐 warm（SWR ゲート）— cacheOnly な full-query は
  //       getRecordsFromCache から読むため、子レコードを引けるようにここで常駐させる。
  // includeChildData フラグでは絞らない（本機能は件数バッジ／CHILD_FORM_* とは独立）。
  // headless / google.script.run 不可のときは無言でスキップ（現フォームのみで解決）。
  // 親レコードが再同期された（modifiedAtUnixMs が進んだ）ときも再走し、子レコードを SWR で
  // 検証する（forceSync しない＝stale のときだけサーバ往復）。これで CHILD_FORM_* 側（件数バッジ
  // 等）と追従タイミングが揃い、別フォーム参照の full-query 置換も親更新に合わせて再解決される。
  useCancellable(async (isCancelled) => {
    if (inChildContext) {
      // 子フォーム文脈では formLink を辿らない＝ロード待ちは無いので即「完了」。
      setChildFormsReady(true);
      return;
    }
    if (formLinkFields.length === 0 || !hasScriptRun()) {
      setChildForms((prev) => (prev.length === 0 ? prev : []));
      setChildFormsReady(true);
      return;
    }
    setChildFormsReady(false);
    // 1. 子フォーム定義を並列取得（FROM 名解決用 title／pid 列を含む schema）。
    //    取得失敗は null に畳んで以降フィルタ（その子フォームは参照不可のまま）。
    const defResults = await Promise.all(
      formLinkFields.map((field) => getChildFormCached_(field.childFormId).catch(() => null)),
    );
    if (isCancelled()) return;
    const defs = defResults.filter((def) => def && def.id);
    // 2. 子フォームレコードを SWR で並列 warm。shouldSync は await（公開前に常駐させる）、
    //    shouldBackground は裏更新し、完了時に epoch を進めて prefetch を再走させる。
    await Promise.all(
      formLinkFields.map(async (field) => {
        try {
          const cache = await getRecordsFromCache(field.childFormId);
          const { shouldSync, shouldBackground } = evaluateCacheForRecords({
            lastSyncedAt: cache.lastSyncedAt,
            hasData: Array.isArray(cache.entries) && cache.entries.length > 0,
            forceSync: false,
          });
          if (shouldSync) {
            await dataStore.listEntries(field.childFormId);
          } else if (shouldBackground) {
            dataStore.listEntries(field.childFormId)
              .then(() => { if (!isCancelled()) setChildReadyEpoch((n) => n + 1); })
              .catch(() => {});
          }
        } catch (_e) { /* warm 失敗は無言（その子フォームは 0 件のまま） */ }
      }),
    );
    if (isCancelled()) return;
    // 3. 定義を公開し、prefetch を再走させる（同期 warm 済みレコードが常駐した状態で解決）。
    setChildForms(defs);
    setChildReadyEpoch((n) => n + 1);
    setChildFormsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formLinkSignature, inChildContext, settings.modifiedAtUnixMs]);

  // オーバーレイ等で子レコードが保存/複製されると childRecordsMemoryStore が invalidate される。
  // その通知を受けて、親プレビューの「子件数バッジ・取り込み子データ（includeChildData）・
  // full-query({{SELECT}}) 集計」を再計算する。再計算はローカル warm ストア（recordsMemoryStore：
  // 楽観保存で更新済み）から行うのでサーバ往復せず、背景のスプレッドシート書き込み完了を待たずに
  // 即座に正しい値へ反映できる（保存直後のサーバ未反映によるレースを避ける）。
  useEffect(() => {
    if (inChildContext) return undefined;
    const childIds = new Set(formLinkFields.map((f) => f.childFormId));
    if (childIds.size === 0) return undefined;
    const unsubscribe = subscribeChildFormChange((changedChildFormId) => {
      if (!childIds.has(changedChildFormId)) return;
      const recordId = recordIdRef.current;
      if (!recordId) return;
      const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
      (async () => {
        for (const field of formLinkFields) {
          if (field.childFormId !== changedChildFormId) continue;
          try {
            const cache = await getRecordsFromCache(field.childFormId);
            const recs = (ensureArray(cache.entries))
              .filter((e) => String(e?.pid ?? "") === recordId)
              .filter((e) => !(e?.deletedAtUnixMs || e?.deletedAt));
            // 全 formLink で常に詳細を再構築する（メイン取得 effect と同じ always-detail 方針）。
            const childForm = await getChildFormCached_(field.childFormId);
            const childObj = buildChildDataObject({
              childFormId: field.childFormId,
              childFormName: field.childFormName,
              childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, recordId),
              childSchema: childForm && childForm.schema ? childForm.schema : [],
              records: recs,
            });
            setFormLinkChildData((prev) => ({ ...prev, [field.id]: childObj }));
            setFormLinkChildCounts((prev) => ({ ...prev, [field.id]: childObj.count }));
            await saveChildDataToCache(field.childFormId, recordId, childObj);
          } catch (_e) { /* 再計算失敗は無言（次回の通常再取得で整合） */ }
        }
        // full-query（{{SELECT}}）置換も子レコード変化に追従させる（warm ストアは更新済み）。
        setChildReadyEpoch((n) => n + 1);
      })();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formLinkSignature, inChildContext]);

  // 現レコードの「入力中ライブ値」を view 行に変換する。保存と同じ collectResponses →
  // entriesToViewTableRows 経路を使うので、キャッシュ行と同形状になり `_form` の現レコード行を
  // 上書きできる（自己参照・新規レコードでも入力中の値で full-query が解決する）。
  const buildLiveRow = (currentResponses) => {
    const liveEntry = {
      id: recordIdRef.current,
      "No.": settings.recordNo,
      data: collectResponses(schema, currentResponses || {}),
      createdAt: settings.createdAt,
      createdBy: settings.createdBy,
      modifiedBy: settings.modifiedBy,
    };
    return buildLiveViewRow({ id: settings.formId || "", schema }, liveEntry);
  };

  // 入力に応じて full-query 置換を再解決するためのデバウンス済みトリガ。dataValueMap（=入力）が
  // 変わるたびにタイマをリセットし、一定時間アイドルで epoch を進めて下の prefetch effect を再実行する。
  const [liveQueryEpoch, setLiveQueryEpoch] = useState(0);
  useEffect(() => {
    if (!hasFullQuerySubstitution) return undefined;
    const t = setTimeout(() => setLiveQueryEpoch((n) => n + 1), LIVE_QUERY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [dataValueMap, hasFullQuerySubstitution]);

  // substitution テンプレ内の full-query トークン（`{{SELECT ...}}`）を非同期に解決して
  // queryTokenValues に載せる。式トークンは precompile 経路、full-query はこの経路で別々に
  // 解決し、どちらも resolveTemplate（同期）へ供給する。liveRowOverride で現レコード行を
  // 入力中の値に差し替えるため、liveQueryEpoch（デバウンス済みの入力変化）でも再実行する。
  useCancellable(async (isCancelled) => {
    // schema/formId/entryId が変わるたびに「未完了」へ戻す（初回は同値で React がバイパス）。
    setQueryTokensReady(false);
    const templates = collectTemplateTexts(schema);
    if (templates.length === 0) {
      // prefetch すべき full-query が無い＝完了扱い（万一の欠落トークンは警告対象にする）。
      if (!isCancelled()) setQueryTokensReady(true);
      return;
    }
    // 全テンプレを連結して一括 prefetch（forms 取得・テーブル登録を 1 回で共有）。
    // full-query トークンが無ければ prefetchQueryTokens は空 Map を返す（高速パス）。
    // liveRowOverride: 現レコード行を入力中のライブ値で上書きして解決する。
    const ctx = { recordId: recordIdRef.current, formId: settings.formId || "", forms: previewForms, liveRowOverride: buildLiveRow(responses) };
    let map;
    try {
      map = await prefetchQueryTokens(templates.join("\n"), ctx);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[PreviewPage] full-query prefetch failed", err && err.message);
      }
      // prefetch 失敗も「完了」: 以降の未解決は本物の失敗として警告に出す。
      if (!isCancelled()) setQueryTokensReady(true);
      return;
    }
    if (isCancelled()) return;
    setQueryTokenValues((prev) => (map.size === 0 && prev.size === 0 ? prev : map));
    setQueryTokensReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, settings.formId, entryId, liveQueryEpoch, childReadyEpoch]);

  const { computedValues, computedErrors } = useMemo(
    () => evaluateAllComputedFields(schema, responses, dataValueMap, tokenContext),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema, responses, dataValueMap, tokenContext, precompileEpoch],
  );

  const resolveTokens = useMemo(() => {
    const dataMap = { ...dataValueMap };
    if (computedValues) {
      const fieldPathsMap = fieldPaths || {};
      for (const [fid, val] of Object.entries(computedValues)) {
        const path = fieldPathsMap[fid];
        if (path && val != null) {
          dataMap[path] = String(val);
        }
      }
    }
    const ctx = { ...tokenContext, dataValueMap: dataMap };
    return (text) => resolveTemplateTokens(text, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataValueMap, computedValues, fieldPaths, tokenContext, precompileEpoch]);

  const mergedResponses = useMemo(() => {
    if (!computedValues || Object.keys(computedValues).length === 0) return responses;
    return { ...responses, ...computedValues };
  }, [responses, computedValues]);

  const sortedData = useMemo(() => {
    const raw = collectResponses(schema, mergedResponses);
    return sortResponses(raw, schema, mergedResponses);
  }, [schema, mergedResponses]);
  const output = sortedData.map;
  const sortedKeys = sortedData.keys;

  const [isSaving, setIsSaving] = useState(false);
  const updateDriveFolderStateFromPrintResult = (result) => {
    if (typeof onFieldDriveFolderStateChange !== "function") return;
    if (!primaryFileUploadFieldId) return;
    onFieldDriveFolderStateChange(primaryFileUploadFieldId, (prev) => {
      const currentEffectiveFolderUrl = resolveEffectiveDriveFolderUrl(prev);
      const nextResolvedUrl = typeof result?.folderUrl === "string" && result.folderUrl.trim()
        ? result.folderUrl.trim()
        : (currentEffectiveFolderUrl || prev.resolvedUrl);
      const keepAutoCreated = prev.autoCreated && prev.resolvedUrl.trim() && prev.resolvedUrl.trim() === nextResolvedUrl;
      return {
        ...prev,
        resolvedUrl: nextResolvedUrl,
        inputUrl: prev.inputUrl.trim() ? prev.inputUrl : nextResolvedUrl,
        autoCreated: keepAutoCreated || result?.autoCreated === true,
        pendingPrintFileIds: appendDriveFileId(prev.pendingPrintFileIds, result?.fileId),
      };
    });
  };
  const handleFieldTemplateAction = async (field) => {
    const action = normalizePrintTemplateAction(field?.printTemplateAction);
    if (!action.enabled) return;

    const validation = validateOutputAction(action, settings);
    if (!validation.valid) {
      showAlert(validation.error);
      return;
    }

    const effectiveFileNameTemplate = resolveEffectivePrintTemplateFileNameTemplate(action, settings);
    const effectiveFolderUrl = resolveEffectiveDriveFolderUrl(primaryDriveFolderState);

    // full-query トークン（`{{SELECT ...}}`）はクライアントで事前解決して GAS へ渡す
    // （GAS にクエリエンジンは無い）。単純な式トークンは原文のまま GAS が payload から解決。
    // 失敗しても出力は継続（未解決トークンは GAS 側でリテラル/フォールバック）。
    const qctx = { recordId: recordIdRef.current, formId: settings.formId || "", forms: previewForms };
    let resolvedFileNameTemplate = effectiveFileNameTemplate;
    let outAction = action;
    try {
      resolvedFileNameTemplate = await resolveQueryTokensInTemplate(effectiveFileNameTemplate, qctx);
      outAction = {
        ...action,
        fileNameTemplate: await resolveQueryTokensInTemplate(action.fileNameTemplate, qctx),
        gmailTemplateTo: await resolveQueryTokensInTemplate(action.gmailTemplateTo, qctx),
        gmailTemplateCc: await resolveQueryTokensInTemplate(action.gmailTemplateCc, qctx),
        gmailTemplateBcc: await resolveQueryTokensInTemplate(action.gmailTemplateBcc, qctx),
        gmailTemplateSubject: await resolveQueryTokensInTemplate(action.gmailTemplateSubject, qctx),
        gmailTemplateBody: await resolveQueryTokensInTemplate(action.gmailTemplateBody, qctx),
      };
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[PreviewPage] full-query 事前解決に失敗", err && err.message);
      }
    }

    const baseDriveTemplateSettings = {
      ...driveSettings,
      ...(effectiveFolderUrl ? { folderUrl: effectiveFolderUrl } : {}),
      recordId: recordIdRef.current,
      responses: responses || {},
      fieldValues,
    };
    try {
      const result = await gasClientRef.current.executeRecordOutputAction({
        action: outAction,
        settings: {
          standardPrintTemplateId: resolveStandardPrintTemplateId(settings),
          standardPrintFileNameTemplate: settings.standardPrintFileNameTemplate || "",
        },
        recordContext: {
          formTitle,
          formId: settings.formId || "",
          recordId: recordIdRef.current,
          recordNo: settings.recordNo || "",
          modifiedAt: settings.modifiedAtUnixMs ?? settings.modifiedAt ?? "",
          printPayload: getPrintDocumentPayload({
            driveFolderState: primaryDriveFolderState,
            useTemporaryFolder: true,
          }),
        },
        driveSettings: {
          ...baseDriveTemplateSettings,
          fileNameTemplate: resolvedFileNameTemplate,
        },
      });
      if (result?.fileId || result?.folderUrl) {
        updateDriveFolderStateFromPrintResult(result);
      }
      if (result?.openUrl) {
        const outputType = result.outputType || action.outputType || "";
        showOutputAlert({
          message: "様式出力を準備しました。",
          url: result.openUrl,
          linkLabel: outputType === "gmail"
            ? "Gmail下書きを開く"
            : (outputType === "googleDoc" ? "Google ドキュメントを開く" : "ファイルを開く"),
        });
      }
      if (result?.pdfBase64 && result?.fileName) {
        downloadPdfFromBase64(result.pdfBase64, result.fileName);
      }
    } catch (error) {
      showAlert(`様式出力に失敗しました: ${toErrorMessage(error)}`);
    }
  };

  // 外部アクション 質問カードのボタン押下時。レコード内容を外部 GAS Web アプリ等へ送る。
  // 送信は本体 GAS のサーバ間リレー（sendExternalAction → nfbSendExternalAction → UrlFetchApp）。
  // ブラウザの隠しフォーム POST に伴うログインリダイレクト（POST 本文消失）を避ける。
  // URL のトークン解決は印刷様式と共通の alasql `{{...}}` エンジン（resolveTemplateTokensAsync）に統一。
  // 機微予約トークン（_spreadsheet_id 等）は adminOnly && isAdmin のときだけ展開を許可する。
  const handleFieldExternalAction = async (field) => {
    const action = normalizeExternalAction(field?.externalAction);
    const gate = { adminOnly: !!action.adminOnly, isAdmin };
    // 機微予約トークンが許可なく参照されていたら送信中止（漏洩防止・URL 早期失敗を維持）。
    if (hasBlockedSensitiveRefs(extractReservedRefs(action.url), gate)) {
      showAlert("この URL には管理者限定のトークンが含まれています。質問カードの設定で「管理者のみ」を有効にするか、トークンを見直してください。");
      return;
    }
    if (!hasScriptRun()) {
      showAlert("この機能はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const sensitiveAllowed = gate.adminOnly && gate.isAdmin;
    const spreadsheetId = normalizeSpreadsheetId(settings.spreadsheetId || "");
    const sheetName = settings.sheetName || "Data";
    const driveFileUrl = settings.driveFileUrl || "";
    const externalActionCtx = {
      ...tokenContext,
      formName: formTitle,
      dataValueMap,
      valueTransform: encodeURIComponent,
      ...(sensitiveAllowed ? {
        spreadsheetId,
        spreadsheetUrl: buildSpreadsheetUrl(spreadsheetId),
        sheetName,
        driveFileUrl,
        userEmail: currentUserEmail,
      } : {}),
    };
    let resolvedUrl = "";
    try {
      resolvedUrl = await resolveTemplateTokensAsync(action.url, externalActionCtx);
    } catch (_e) {
      resolvedUrl = "";
    }
    if (!isValidExternalActionUrl(resolvedUrl)) {
      showAlert("URL が不正です (http:// または https:// で始まる必要があります)。質問カードの設定を確認してください。");
      return;
    }
    // formLink 項目の子フォームデータを、他の質問カードと同じ record.items 列へ展開する
    // （印刷様式と同じ childFormMeta マップを使い 外部アクション/印刷の渡し方を揃える）。
    const record = {
      id: recordIdRef.current,
      no: settings.recordNo ?? "",
      items: buildRecordItems(schema, responses, { childDataByFieldId: childFormMeta }),
    };
    const payload = buildExternalActionPayload({
      context: "record",
      formId: settings.formId || "",
      formName: formTitle,
      base: { record },
      storageFields: { spreadsheetId, sheetName, driveFileUrl, userEmail: currentUserEmail },
      gate,
    });
    // 「アップロードファイルも送信する」が ON のときだけ、このレコードの fileUpload 参照を
    // 渡す。実体の取得・base64 化は Drive 権限を持つ本体 GAS（ExtAction_send_）が行う。
    const files = action.sendFiles
      ? collectExternalActionFiles(schema, { responses, folderNamesByField })
      : [];
    try {
      const res = await sendExternalAction({ url: resolvedUrl, payload, files });
      const result = interpretExternalActionResponse(res);
      if (!result.ok) {
        showAlert(result.message || "外部アクションの送信先でエラーが発生しました。");
        return;
      }
      if (result.openUrl) {
        showOutputAlert({
          message: result.message || "外部アクションを送信しました。",
          url: result.openUrl,
          linkLabel: "結果を開く",
        });
      } else {
        showAlert(result.message || "外部アクションを送信しました。");
      }
    } catch (error) {
      // 誤送信防止ハンドシェイクで宛先を確認できなかったときは、その理由をそのまま伝える。
      if (error?.code === "DEST_UNVERIFIED") {
        showAlert(toErrorMessage(error));
        return;
      }
      showAlert(`外部アクション送信に失敗しました: ${toErrorMessage(error)}`);
    }
  };

  // 「別フォームを開く」カードのボタン押下時。選択フォームを別タブで開く。
  // pid はこのレコードの ID（recordIdRef.current）。開いた先はその pid に紐づく行だけを表示し、
  // 新規行にもその pid が刻まれる（＝そのレコードに紐づく子フォーム）。
  const handleFieldFormLinkAction = (field) => {
    const childFormId = typeof field?.childFormId === "string" ? field.childFormId.trim() : "";
    if (!childFormId) {
      showAlert("開くフォームが設定されていません。質問カードの設定で対象フォームを選択してください。");
      return;
    }
    // 子フォームを同一 SPA のオーバーレイで開く（新規タブのフルロードを避ける）。pid に現レコード
    // ID を渡し、子フォームの検索を pid 絞り込み・新規レコードに pid 刻印させる。親はマウントしたまま
    // 残り、「← 戻る」で復帰する。openChildForm が未提供（Provider 外）なら従来の新規タブへフォールバック。
    if (typeof openChildForm === "function") {
      openChildForm({
        childFormId,
        pid: recordIdRef.current,
        childFormName: field?.childFormName || field?.label || "",
      });
      return;
    }
    const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
    const url = buildChildFormUrl(baseUrl, childFormId, recordIdRef.current);
    if (!url) {
      showAlert("フォームの URL を組み立てられませんでした。");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const getPrintDocumentPayload = (options = {}) => buildPrintDocumentPayload({
    schema,
    responses,
    settings,
    recordId: recordIdRef.current,
    omitEmptyRows: options.omitEmptyRows,
    driveFolderState: options.driveFolderState ?? primaryDriveFolderState,
    useTemporaryFolder: options.useTemporaryFolder === true,
    folderUrlsByField,
    childDataByFieldId: childFormMeta,
  });

  const handleSaveToSheet = async (options = {}) => {
    let alertShown = false;
    setIsSaving(true);
    try {
      if (readOnly) {
        throw new Error("read_only_mode");
      }
      const validationResult = collectValidationErrors(schema, responses);
      if (validationResult.errors.length > 0) {
        showAlert(formatValidationErrors(validationResult), "入力エラー");
        alertShown = true;
        throw new Error("validation_failed");
      }

      let formId = null;
      if (!onSave) {
        const scriptRunAvailable = hasScriptRun();
        formId = settings.formId || "";
        // spreadsheetId はサーバ側で formId から解決する。設定済みかは hasSpreadsheet/ID で判定。
        const hasSpreadsheet = Boolean(settings.spreadsheetId || settings.hasSpreadsheet);
        if (!formId || !hasSpreadsheet) {
          showAlert("保存先スプレッドシートが設定されていません。フォームを保存してから送信してください。");
          alertShown = true;
          throw new Error("missing_spreadsheet_id");
        }
        if (!scriptRunAvailable) {
          showAlert("この機能はGoogle Apps Script環境でのみ利用可能です");
          alertShown = true;
          throw new Error("missing_script_run");
        }
      }

      // full-query 置換は非同期 prefetch で解決されるため、保存時に解決値を確実に確定させる。
      // 入力中のライブ行で再 prefetch → computedValues 再計算 → シリアライズ（描画時の output は
      // prefetch 未完了だと空のことがあり、collectResponses の空値ガードに弾かれて保存漏れする）。
      let saveResponses = output;
      let saveOrder = sortedKeys;
      if (hasFullQuerySubstitution) {
        try {
          const fqTemplates = collectTemplateTexts(schema, { substitutionOnly: true });
          const freshMap = await prefetchQueryTokens(fqTemplates.join("\n"), {
            recordId: recordIdRef.current,
            formId: settings.formId || "",
            forms: previewForms,
            liveRowOverride: buildLiveRow(responses),
          });
          const { computedValues: freshComputed } = evaluateAllComputedFields(
            schema,
            responses,
            dataValueMap,
            { ...tokenContext, queryTokenValues: freshMap, queryTokensReady: true },
          );
          const freshMerged = { ...responses, ...freshComputed };
          const freshSorted = sortResponses(collectResponses(schema, freshMerged), schema, freshMerged);
          saveResponses = freshSorted.map;
          saveOrder = freshSorted.keys;
        } catch (err) {
          if (typeof console !== "undefined") {
            console.warn("[PreviewPage] save-time full-query resolve failed; using last render", err && err.message);
          }
        }
      }

      const payload = {
        version: 1,
        formTitle,
        schemaHash: computeSchemaHash(schema),
        id: recordIdRef.current,
        responses: saveResponses,
        order: saveOrder,
      };

      if (onSave) {
        const result = await onSave({
          payload,
          sortedKeys: saveOrder,
          recordId: recordIdRef.current,
          responses,
          options,
        });
        return result ?? payload;
      }
      const res = await submitResponses({
        formId,
        sheetName: settings.sheetName || "Data",
        payload,
      });
      const msg = res?.spreadsheetUrl
        ? `送信しました（${res.sheetName} に追記 / 行: ${res.rowNumber}）`
        : "送信しました";
      showAlert(msg);
      return res;
    } catch (error) {
      console.error("[PreviewPage] Error in handleSaveToSheet:", error);
      const suppressAlert = alertShown
        || error?.message === "validation_failed"
        || error?.message === "missing_spreadsheet_id"
        || error?.message === "missing_script_run"
        || error?.message === "read_only_mode";
      if (!options?.silent && !suppressAlert) {
        showAlert(`送信に失敗しました: ${toErrorMessage(error)}`);
      }
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      submit: handleSaveToSheet,
      getRecordId: () => recordIdRef.current,
      getOutput: () => ({ map: output, keys: sortedKeys }),
      getPrintDocumentPayload,
    }),
    [getPrintDocumentPayload, handleSaveToSheet, output, sortedKeys],
  );

  return (
    <div className="nf-card" data-depth="0">
      <h2 className="preview-title">{formTitle}</h2>
      {settings.showRecordNo !== false && (
        <div className="nf-mb-12">
          <label className="preview-label">No.</label>
          <input
            type="text"
            value={settings.recordNo || ""}
            readOnly={readOnly}
            className={`nf-input${readOnly ? " nf-input--readonly" : ""}`}
            onChange={(event) => {
              if (readOnly || typeof onRecordNoChange !== "function") return;
              onRecordNoChange(event.target.value);
            }}
          />
        </div>
      )}
      <div className="nf-mb-12">
        <label className="preview-label">ID</label>
        <input type="text" value={recordIdRef.current} readOnly className="nf-input nf-input--readonly" />
      </div>
      {settings.pid ? (
        <div className="nf-mb-12">
          <label className="preview-label">親レコードID（pid）</label>
          <input type="text" value={settings.pid} readOnly disabled className="nf-input nf-input--disabled" />
        </div>
      ) : null}
      <div className="nf-mb-12">
        <label className="preview-label">最終更新日時</label>
        <input type="text" value={modifiedAtDisplay || "-"} readOnly className="nf-input nf-input--readonly" />
      </div>
      <RendererRecursive
        fields={schema}
        responses={responses}
        onChange={setResponses}
        readOnly={readOnly}
        entryId={entryId}
        onChildFormJump={onChildFormJump}
        driveSettings={driveSettings}
        gasClientRef={gasClientRef}
        driveFolderStates={driveFolderStates}
        onFieldDriveFolderStateChange={onFieldDriveFolderStateChange}
        onTemplateAction={handleFieldTemplateAction}
        onExternalAction={handleFieldExternalAction}
        onFormLinkAction={handleFieldFormLinkAction}
        formLinkChildCounts={formLinkChildCounts}
        hideFormLink={inChildContext}
        isAdmin={isAdmin}
        canDeleteDriveFolder={canDeleteDriveFolder}
        onDeleteDriveFolder={onDeleteDriveFolder}
        resolveTokens={resolveTokens}
        substitutionPending={!queryTokensReady || !childFormsReady}
        computedValues={computedValues}
        computedErrors={computedErrors}
      />
      {showOutputJson && (
        <div className="nf-mt-12">
          <label className="preview-label">回答JSON</label>
          <textarea
            readOnly
            value={JSON.stringify(output, null, 2)}
            className={`${s.input.className} preview-json`}
          />
        </div>
      )}
      {showSaveButton && !readOnly && (
        <div className="nf-row nf-gap-8 nf-mt-12 nf-justify-end">
          <button type="button" className={s.btn.className} onClick={handleSaveToSheet} disabled={isSaving}>
            {isSaving ? "保存中..." : saveButtonLabel}
          </button>
        </div>
      )}
</div>
  );
});

export default PreviewPage;
