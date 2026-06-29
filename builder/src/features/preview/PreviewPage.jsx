import { openInNewTab } from "../../utils/openWindow.js";
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../../utils/errorMessage.js";
import { collectResponses, sortResponses, buildDataValueMap } from "../../core/collect.js";
import { computeSchemaHash } from "../../core/schema.js";
import { collectValidationErrors, formatValidationErrors } from "../../core/validate.js";
import * as gasClientModule from "../../services/gasClient.js";
const { submitResponses, hasScriptRun, getUrlPid, sendExternalAction } = gasClientModule;
import { normalizeSpreadsheetId, childFormSpreadsheetId, childFormSheetName } from "../../utils/spreadsheet.js";
import { styles as s } from "../editor/styles.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { collectDefaultNowResponses } from "../../utils/responses.js";
import { genRecordId } from "../../core/ids.js";
import { resolveTemplateTokens, resolveTemplateTokensAsync, precompileTemplateTokens, prefetchQueryTokens, resolveQueryTokensInTemplate } from "../../utils/tokenReplacer.js";
import { extractReservedRefs } from "../../features/expression/templateEvaluator.js";
import { evaluateAllComputedFields } from "../../core/computedFields.js";
import { buildPreviewLiveRow } from "./previewLiveRow.js";
import {
  buildPrintDocumentPayload,
  buildFieldPathsMap,
  buildFieldValuesMap,
  collectFileUploadMeta,
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
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";
import { collectFileUploadFields } from "../../core/schema.js";
import { buildSharedFormUrl, buildSharedRecordUrl, buildChildFormUrl } from "../../utils/formShareUrl.js";
import { getChildFormCached_, collectFormLinkFields } from "./childFormData.js";
import { evaluateCacheForRecords } from "../../app/state/cachePolicy.js";
import { dataStore } from "../../app/state/dataStore.js";
import { getRecordsFromCache } from "../../app/state/recordsMemoryStore.js";
import { useFormContext, useChildForm } from "../../app/state/formContext.jsx";
import { RendererRecursive } from "./FieldRenderer.jsx";
import { collectTemplateTexts, detectFullQuerySubstitution } from "./previewTemplates.js";
import { computeNextDriveFolderStateFromPrintResult } from "./previewDriveFolder.js";
import { useFormLinkChildData } from "./useFormLinkChildData.js";
import PreviewRecordMeta from "./PreviewRecordMeta.jsx";

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

  // 件数取得は「既存レコード（保存済み id あり）」かつ GAS 利用可かつ子フォーム文脈でない場合のみ。
  // 子レコード / 件数は childRecordsMemoryStore に SWR キャッシュする：キャッシュがあれば即表示し、
  // しきい値（cachePolicy）に従って裏で再検証。新鮮なら GAS 往復しない。
  // 親の同期（modifiedAtUnixMs 変化）時は forceSync で必ずハード再取得する。失敗は無言。
  const formLinkSignature = formLinkFields
    .map((f) => `${f.id}:${f.childFormId}`)
    .join("|");
  // 子フォーム定義のロード＋レコード warming 完了を prefetch effect へ伝えるための epoch。
  // useFormLinkChildData の subscribe 再計算からも進める（state setter は識別子安定）。
  const [childReadyEpoch, setChildReadyEpoch] = useState(0);
  const { formLinkChildCounts, childFormMeta } = useFormLinkChildData({
    formLinkFields,
    formLinkSignature,
    inChildContext,
    recordIdRef,
    recordId: settings.recordId,
    modifiedAtUnixMs: settings.modifiedAtUnixMs,
    bumpChildReadyEpoch: () => setChildReadyEpoch((n) => n + 1),
  });

  // レコードのアップロードフォルダは先頭 fileUpload 質問（primary）が所有する単一フォルダ。
  // primary の folderUrl / folderName を全 fileUpload フィールドへブロードキャストし、
  // 印刷様式・外部アクション payload・論理パス再リンクが全カードで同一フォルダを指すようにする。
  const primaryFileUploadFieldId = useMemo(
    () => collectFileUploadFields(schema)[0]?.id || "",
    [schema],
  );
  const primaryDriveFolderState = useMemo(
    () => normalizeDriveFolderState((driveFolderStates || {})[primaryFileUploadFieldId]),
    [driveFolderStates, primaryFileUploadFieldId],
  );
  const uploadFieldIds = useMemo(
    () => collectFileUploadFields(schema).map((f) => f?.id).filter(Boolean),
    [schema],
  );
  const folderUrlsByField = useMemo(() => {
    const out = {};
    const url = (primaryDriveFolderState.resolvedUrl || primaryDriveFolderState.inputUrl || "").trim();
    if (url) uploadFieldIds.forEach((fid) => { out[fid] = url; });
    return out;
  }, [uploadFieldIds, primaryDriveFolderState]);
  const folderNamesByField = useMemo(() => {
    const out = {};
    const folderName = (primaryDriveFolderState.folderName || "").trim();
    if (folderName) uploadFieldIds.forEach((fid) => { out[fid] = folderName; });
    return out;
  }, [uploadFieldIds, primaryDriveFolderState]);
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

  // 現レコードの「入力中ライブ値」を view 行に変換する（純関数 buildPreviewLiveRow へ委譲）。
  const buildLiveRow = (currentResponses) => buildPreviewLiveRow({
    schema,
    settings,
    recordId: recordIdRef.current,
    responses: currentResponses,
  });

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
    onFieldDriveFolderStateChange(primaryFileUploadFieldId, (prev) =>
      computeNextDriveFolderStateFromPrintResult(prev, result));
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
    // 子フォーム（formLink）の保存先スプレッドシート ID / シート名を解決する。管理者限定ボタン＋
    // 管理者のときだけ。親フォームの formLink は通常 1 つなので最初の非空 ID を採る（検索一覧の
    // firstChildSpreadsheetId と同じ単一値方針）。buildExternalActionPayload 側で
    // childSpreadsheetUrl に展開され、リレー先が子シートへの書き込み/リンク表示に使う。
    let childSpreadsheetId = "";
    let childSheetName = "";
    if (sensitiveAllowed) {
      for (const field of formLinkFields) {
        try {
          const childForm = await getChildFormCached_(field.childFormId);
          const sid = childFormSpreadsheetId(childForm);
          if (sid) {
            childSpreadsheetId = sid;
            childSheetName = childFormSheetName(childForm);
            break;
          }
        } catch (_e) { /* 取得失敗の子フォームはスキップ（無言） */ }
      }
    }
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
    // formLink 項目の子フォームデータを、他の質問カードと同じ items 列へ展開する
    // （印刷様式と同じ childFormMeta マップを使い 外部アクション/印刷の渡し方を揃える）。
    // ファイル参照（名前・URL・フォルダ URL）は folderUrlsByField/folderNamesByField を渡して
    // items[].files / folderUrl に内包する（受信側は items から読む。サーバ側 Drive 解決は廃止）。
    const record = {
      id: recordIdRef.current,
      no: settings.recordNo ?? "",
      items: buildRecordItems(schema, responses, { childDataByFieldId: childFormMeta, folderUrlsByField, folderNamesByField }),
    };
    // 起動元に依らない統一フォーマット（records 配列 + recordCount）。編集画面は常に 1 件。
    const payload = buildExternalActionPayload({
      formId: settings.formId || "",
      formName: formTitle,
      base: { records: [record], recordCount: 1 },
      storageFields: { spreadsheetId, sheetName, driveFileUrl, userEmail: currentUserEmail, childSpreadsheetId, childSheetName },
      gate,
    });
    try {
      const res = await sendExternalAction({ url: resolvedUrl, payload });
      const result = interpretExternalActionResponse(res);
      if (!result.ok) {
        // ok:false でも openUrl があれば新タブで開く（受信側の権限付与誘導に対応）。
        const errUrl = result.openUrl || resolvedUrl;
        const errLinkLabel = result.openUrl ? "送信先を開く" : "送信先ページを開く";
        showOutputAlert({
          message: result.message || "外部アクションの送信先でエラーが発生しました。",
          url: errUrl,
          linkLabel: errLinkLabel,
        });
        if (result.openUrl) {
          openInNewTab(result.openUrl);
        }
        return;
      }
      if (result.openUrl) {
        showOutputAlert({
          message: result.message || "外部アクションを送信しました。",
          url: result.openUrl,
          linkLabel: "結果を開く",
        });
      } else if (result.htmlBody) {
        // HTML 応答は権限付与ページへのリダイレクト等の可能性がある。
        showOutputAlert({
          message: result.message,
          url: resolvedUrl,
          linkLabel: "送信先ページを開く",
        });
      } else {
        showAlert(result.message || "外部アクションを送信しました。");
      }
    } catch (error) {
      // 誤送信防止ハンドシェイクで宛先を確認できなかったときは、その理由をそのまま伝える。
      const catchUrl = resolvedUrl;
      if (error?.code === "DEST_UNVERIFIED") {
        showOutputAlert({ message: toErrorMessage(error), url: catchUrl, linkLabel: "送信先ページを開く" });
        return;
      }
      showOutputAlert({
        message: `外部アクション送信に失敗しました: ${toErrorMessage(error)}`,
        url: catchUrl,
        linkLabel: "送信先ページを開く",
      });
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
        // 親レコードが表示専用・編集不可（view/ロック/form.readOnly の合成 readOnly）なら、
        // 子フォームも閲覧のみで開く。
        parentReadOnly: readOnly,
      });
      return;
    }
    const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
    const url = buildChildFormUrl(baseUrl, childFormId, recordIdRef.current);
    if (!url) {
      showAlert("フォームの URL を組み立てられませんでした。");
      return;
    }
    openInNewTab(url);
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
      <PreviewRecordMeta
        settings={settings}
        recordId={recordIdRef.current}
        modifiedAtDisplay={modifiedAtDisplay}
        readOnly={readOnly}
        onRecordNoChange={onRecordNoChange}
      />
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
        primaryFileUploadFieldId={primaryFileUploadFieldId}
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
