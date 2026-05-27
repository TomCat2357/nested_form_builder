export const hasScriptRun = () => typeof google !== "undefined" && google?.script?.run;

const normalizeScriptRunError = (err) => {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (err && typeof err.message === "string") return new Error(err.message);
  try { return new Error(JSON.stringify(err) || "Apps Script call failed"); }
  catch (jsonErr) { return new Error("Apps Script call failed"); }
};

const createGasApiError = (message, { code, result } = {}) => {
  const error = new Error(message);
  if (code) error.code = code;
  if (result !== undefined) error.result = result;
  return error;
};

export const callScriptRun = (functionName, payload) =>
  new Promise((resolve, reject) => {
    if (!hasScriptRun()) {
      reject(new Error("この機能はGoogle Apps Script環境でのみ利用可能です"));
      return;
    }
    const safeFunctionName = typeof functionName === "string" ? functionName.trim() : "";
    if (!safeFunctionName) {
      reject(new Error("Apps Script functionName is required"));
      return;
    }

    const runner = google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => reject(normalizeScriptRunError(error)));

    const remoteFunction = runner?.[safeFunctionName];
    if (typeof remoteFunction !== "function") {
      reject(new Error(`Apps Script function "${safeFunctionName}" is not available`));
      return;
    }

    try {
      remoteFunction.call(runner, payload);
    } catch (error) {
      reject(normalizeScriptRunError(error));
    }
  });

// DRY化のための共通APIラッパー
const fetchGasApi = async (functionName, payload, errorMessage) => {
  try {
    const result = await callScriptRun(functionName, payload);
    if (!result || result.ok === false) {
      throw createGasApiError(result?.error || errorMessage, {
        code: result?.code,
        result,
      });
    }
    return result;
  } catch (error) {
    console.error(`[gasClient] ${functionName} failed`, error);
    throw error;
  }
};

const createGasEndpoint = ({
  fnName,
  validate = (...args) => args[0],
  mapResult = (result) => result,
  defaultError = "Apps Script call failed",
}) => async (...args) => {
  const payload = validate(...args);
  const result = await fetchGasApi(fnName, payload, defaultError);
  return mapResult(result);
};

const validateFormId = (formId) => {
  if (!formId) throw new Error("formId is required");
  return formId;
};

const validateFormIds = (formIds) => {
  if (!Array.isArray(formIds) || formIds.length === 0) throw new Error("formIds array is required");
  return formIds;
};

// レコード系の GAS 関数名 (saveResponses / listRecords / getRecord / deleteRecord /
// syncRecordsProxy) は nfb プレフィックスを持たないレガシー契約。GAS 側 (gas/Code.gs,
// gas/codeSyncRecords.gs) の関数名と完全一致が必要で、リネームするなら GAS と本ファイルを
// ロックステップで変えること。詳細は docs/claude/apps-script-backend.md を参照。
//
// spreadsheetId はクライアントから送らない。GAS が formId からサーバ側で解決する
// （非管理者には spreadsheetId を返さないため）。詳細は docs/claude/data-model.md を参照。
export const submitResponses = ({ formId, sheetName = "Data", payload }) => {
  if (!formId) throw new Error("formId is required");
  return fetchGasApi("saveResponses", { ...payload, formId, sheetName }, "Apps Script call failed");
};

export const acquireSaveLock = ({ formId, sheetName = "Data" }) => {
  if (!formId) throw new Error("formId is required");
  return fetchGasApi("nfbAcquireSaveLock", { formId, sheetName }, "Apps Script call failed");
};

export const deleteEntry = ({ formId, sheetName = "Data", entryId }) => {
  if (!formId) throw new Error("formId is required");
  if (!entryId) throw new Error("entryId is required");
  return fetchGasApi("deleteRecord", { formId, sheetName, id: entryId }, "Delete failed");
};

export const getEntry = async ({ formId, sheetName = "Data", entryId, rowIndexHint = null }) => {
  if (!formId) throw new Error("formId is required");
  if (!entryId) throw new Error("entryId is required");
  const result = await fetchGasApi("getRecord", { formId, sheetName, id: entryId, rowIndexHint }, "Get record failed");
  return { record: result.record || null, rowIndex: typeof result.rowIndex === "number" ? result.rowIndex : null };
};

export const listEntries = async ({ sheetName = "Data", formId = null, lastSpreadsheetReadAt = null, forceFullSync = false }) => {
  if (!formId) throw new Error("formId is required");
  const normalizedLastSpreadsheetReadAt = Number(lastSpreadsheetReadAt);
  const payload = {
    sheetName,
    formId,
    forceFullSync: !!forceFullSync,
  };
  if (!forceFullSync && Number.isFinite(normalizedLastSpreadsheetReadAt) && normalizedLastSpreadsheetReadAt > 0) {
    payload.lastSpreadsheetReadAt = normalizedLastSpreadsheetReadAt;
  }
  const result = await fetchGasApi("listRecords", payload, "スプレッドシートからデータ一覧を読み取れませんでした");
  return {
    records: result.records || [],
    headerMatrix: result.headerMatrix || [],
    isDelta: !!result.isDelta,
    allIds: Array.isArray(result.allIds) ? result.allIds : null,
    count: Number.isFinite(result.count) ? result.count : (result.records || []).length,
    sheetLastUpdatedAt: Number.isFinite(result.sheetLastUpdatedAt) ? result.sheetLastUpdatedAt : 0,
  };
};

export const listForms = async (options = {}) => {
  const r = await fetchGasApi("nfbListForms", options, "List forms failed");
  return { forms: r.forms || [], loadFailures: r.loadFailures || [], folders: r.folders || [] };
};
export const listFolders = async () => {
  const r = await fetchGasApi("nfbListFolders", {}, "List folders failed");
  return { folders: r.folders || [] };
};
export const createFolder = async (path) => {
  const r = await fetchGasApi("nfbCreateFolder", path, "Create folder failed");
  return { folders: r.folders || [] };
};
export const moveItems = async ({ formIds = [], folderPaths = [], destPath = "" } = {}) => {
  const r = await fetchGasApi("nfbMoveItems", { formIds, folderPaths, destPath }, "Move failed");
  return { folders: r.folders || [], movedFormIds: r.movedFormIds || [] };
};
export const renameFolder = async ({ path, newName } = {}) => {
  const r = await fetchGasApi("nfbRenameFolder", { path, newName }, "Rename folder failed");
  return { folders: r.folders || [], movedFormIds: r.movedFormIds || [] };
};
export const deleteFolder = async (path) => {
  const r = await fetchGasApi("nfbDeleteFolder", path, "Delete folder failed");
  return { folders: r.folders || [], deletedFormCount: r.deletedFormCount || 0 };
};
export const getForm = async (formId) => {
  if (!formId) throw new Error("formId is required");
  const r = await fetchGasApi("nfbGetForm", formId, "Get form failed");
  return r.form || null;
};
export const saveForm = async (form, targetUrl = null, saveMode = "auto") => {
  if (!form || !form.id) throw new Error("Form with ID is required");
  const r = await fetchGasApi("nfbSaveForm", { form, targetUrl, saveMode }, "Save form failed");
  return { form: r.form, fileUrl: r.fileUrl };
};
export const copyForm = async (formId) => {
  if (!formId) throw new Error("formId is required");
  const r = await fetchGasApi("nfbCopyForm", formId, "Copy form failed");
  return { form: r.form, fileUrl: r.fileUrl };
};
export const deleteFormFromDrive = createGasEndpoint({ fnName: "nfbDeleteForm", validate: validateFormId, defaultError: "Delete form failed" });
export const deleteFormsFromDrive = createGasEndpoint({ fnName: "nfbDeleteForms", validate: validateFormIds, defaultError: "Batch delete forms failed" });
// 単数フォーム操作は GAS 側 (gas/errors.gs Nfb_unwrapSingleResult_, gas/formsPublicApi.gs) が
// バッチ結果を { ok, form } に畳んでから返すので、ここでは r.form を取り出す（呼び出し側は
// AppDataProvider.upsertFormsState に渡す単一フォーム前提）。
// 複数フォーム操作は { ok, forms, errors } のまま返す（呼び出し側は _batchArchiveAction で
// 部分成功/失敗を扱う）。この単数/複数の形状差は意図的。
export const archiveForm = createGasEndpoint({ fnName: "nfbArchiveForm", validate: validateFormId, mapResult: (r) => r.form || null, defaultError: "Archive form failed" });
export const unarchiveForm = createGasEndpoint({ fnName: "nfbUnarchiveForm", validate: validateFormId, mapResult: (r) => r.form || null, defaultError: "Unarchive form failed" });
export const archiveForms = createGasEndpoint({ fnName: "nfbArchiveForms", validate: validateFormIds, defaultError: "Batch archive forms failed" });
export const unarchiveForms = createGasEndpoint({ fnName: "nfbUnarchiveForms", validate: validateFormIds, defaultError: "Batch unarchive forms failed" });
export const setFormReadOnly = createGasEndpoint({ fnName: "nfbSetFormReadOnly", validate: validateFormId, mapResult: (r) => r.form || null, defaultError: "Set form readOnly failed" });
export const clearFormReadOnly = createGasEndpoint({ fnName: "nfbClearFormReadOnly", validate: validateFormId, mapResult: (r) => r.form || null, defaultError: "Clear form readOnly failed" });
export const setFormsReadOnly = createGasEndpoint({ fnName: "nfbSetFormsReadOnly", validate: validateFormIds, defaultError: "Batch set forms readOnly failed" });
export const clearFormsReadOnly = createGasEndpoint({ fnName: "nfbClearFormsReadOnly", validate: validateFormIds, defaultError: "Batch clear forms readOnly failed" });
export const importFormsFromDrive = async (url) => {
  if (!url) throw new Error("Google Drive URL is required");
  const r = await fetchGasApi("nfbImportFormsFromDrive", url, "Import from Drive failed");
  return { forms: r.forms || [], skipped: r.skipped || 0, parseFailed: r.parseFailed || 0, totalFiles: r.totalFiles || 0 };
};
export const registerImportedForm = (payload) => { if (!payload || !payload.form || !payload.fileId) throw new Error("form and fileId are required"); return fetchGasApi("nfbRegisterImportedForm", payload, "Register imported form failed"); };
export const importThemeFromDrive = async (url) => {
  if (!url) throw new Error("Google Drive URL is required");
  const r = await fetchGasApi("nfbImportThemeFromDrive", url, "Theme import failed");
  return { css: r.css || "", fileName: r.fileName || "", fileUrl: r.fileUrl || url };
};
export const getAdminKey = createGasEndpoint({ fnName: "nfbGetAdminKey", validate: () => ({}), mapResult: (r) => r.adminKey || "", defaultError: "Get admin key failed" });
export const setAdminKey = createGasEndpoint({ fnName: "nfbSetAdminKey", mapResult: (r) => r.adminKey || "", defaultError: "Set admin key failed" });
export const getAdminEmail = createGasEndpoint({ fnName: "nfbGetAdminEmail", validate: () => ({}), mapResult: (r) => r.adminEmail || "", defaultError: "Get admin email failed" });
export const setAdminEmail = createGasEndpoint({ fnName: "nfbSetAdminEmail", mapResult: (r) => r.adminEmail || "", defaultError: "Set admin email failed" });
export const checkAdminEmailMembership = createGasEndpoint({
  fnName: "nfbCheckAdminEmailMembership",
  mapResult: (r) => ({
    isMember: Boolean(r.isMember),
    reason: r.reason || null,
    groupErrors: r.groupErrors || {},
    detail: r.detail || "",
  }),
  defaultError: "Admin email membership check failed",
});
export const getRestrictToFormOnly = async () => { const r = await fetchGasApi("nfbGetRestrictToFormOnly", {}, "Get restrict to form only failed"); return Boolean(r.restrictToFormOnly); };
export const setRestrictToFormOnly = async (value) => { const r = await fetchGasApi("nfbSetRestrictToFormOnly", value, "Set restrict to form only failed"); return Boolean(r.restrictToFormOnly); };
// 標準フォルダ構成（作成 / 自動整理フラグ / 構成コピー / マッピング再構築）
export const getStandardFolderAutoFile = async () => { const r = await fetchGasApi("nfbGetStandardFolderAutoFile", {}, "Get auto-file setting failed"); return Boolean(r.autoFile); };
export const setStandardFolderAutoFile = async (value) => { const r = await fetchGasApi("nfbSetStandardFolderAutoFile", value, "Set auto-file setting failed"); return Boolean(r.autoFile); };
export const createStandardFolders = async (rootUrl = "") => {
  const r = await fetchGasApi("nfbCreateStandardFolders", { rootUrl }, "標準フォルダ構成の作成に失敗しました");
  return { rootUrl: r.rootUrl || "", folders: r.folders || [] };
};
export const copyStandardFolders = async ({ destRootUrl, copyData = false, copyWebhooks = false, rebuildMapping = true } = {}) => {
  if (!destRootUrl) throw new Error("コピー先ルートフォルダの URL を指定してください");
  const r = await fetchGasApi("nfbCopyStandardFolders", { destRootUrl, copyData, copyWebhooks, rebuildMapping }, "フォルダ構成のコピーに失敗しました");
  return { destRootUrl: r.destRootUrl || "", summary: r.summary || {}, clearedLinks: r.clearedLinks || 0, rebuildMapping: Boolean(r.rebuildMapping), message: r.message || "" };
};
// 手動フォールバック（UI からは呼ばない。コピー先で自動再構築が失敗した場合のコンソール実行用）。
export const rebuildMappingsFromFolders = async (rootUrl = "") => {
  const r = await fetchGasApi("nfbRebuildMappingsFromFolders", { rootUrl }, "マッピングの再構築に失敗しました");
  return { forms: r.forms || { count: 0 }, questions: r.questions || { count: 0 }, dashboards: r.dashboards || { count: 0 } };
};
// コピー先での自動再構築。再構築マーカーがあるときだけ実行され ran:true を返す。
export const consumePendingRebuild = async () => {
  const r = await fetchGasApi("nfbConsumePendingRebuild", {}, "マッピングの自動再構築に失敗しました");
  return {
    ran: Boolean(r.ran),
    forms: r.forms || { count: 0 },
    questions: r.questions || { count: 0 },
    dashboards: r.dashboards || { count: 0 },
  };
};
export const saveExcelToDrive = ({ filename, base64 }) => fetchGasApi("nfbSaveExcelToDrive", { filename, base64 }, "Driveへの保存に失敗しました");
export const saveFileToDrive = ({ filename, base64, mimeType }) => fetchGasApi("nfbSaveFileToDrive", { filename, base64, mimeType }, "Driveへの保存に失敗しました");
const isSingleRecordPrintPayload = (payload) => {
  return Boolean(payload && payload.fileName && Array.isArray(payload.items));
};

const isMultiRecordPrintPayload = (payload) => {
  return Boolean(
    payload
      && payload.fileName
      && Array.isArray(payload.records)
      && payload.records.length > 0
      && payload.records.every((record) => record && record.fileName && Array.isArray(record.items)),
  );
};

export const uploadFileToDrive = ({ base64, fileName, mimeType, driveSettings }) =>
  fetchGasApi("nfbUploadFileToDrive", { base64, fileName, mimeType, driveSettings }, "ファイルのアップロードに失敗しました");

export const copyDriveFileToDrive = ({ sourceUrl, driveSettings, fileNameTemplate }) =>
  fetchGasApi("nfbCopyDriveFileToDrive", { sourceUrl, driveSettings, fileNameTemplate }, "Driveファイルのコピーに失敗しました");

export const findDriveFileInFolder = ({ fileNameTemplate, outputType, driveSettings }) =>
  fetchGasApi("nfbFindDriveFileInFolder", { fileNameTemplate, outputType, driveSettings }, "Driveファイルの検索に失敗しました");

export const createGoogleDocumentFromTemplate = ({ sourceUrl, driveSettings, fileNameTemplate }) =>
  fetchGasApi(
    "nfbCreateGoogleDocumentFromTemplate",
    { sourceUrl, driveSettings, fileNameTemplate },
    "Googleドキュメント様式の出力に失敗しました",
  );

export const finalizeRecordDriveFolder = (payload) =>
  fetchGasApi("nfbFinalizeRecordDriveFolder", payload, "Driveフォルダの確定に失敗しました");

export const trashDriveFilesByIds = (fileIds) =>
  fetchGasApi("nfbTrashDriveFilesByIds", fileIds, "Driveファイルの削除に失敗しました");

export const createRecordPrintDocument = (payload) => {
  if (!isSingleRecordPrintPayload(payload) && !isMultiRecordPrintPayload(payload)) {
    throw new Error("print document payload is invalid");
  }
  return fetchGasApi("nfbCreateRecordPrintDocument", payload, "印刷様式の出力に失敗しました");
};

export const executeRecordOutputAction = (payload) =>
  fetchGasApi("nfbExecuteRecordOutputAction", payload, "出力処理に失敗しました");

export const executeBatchGoogleDocOutput = (payload) =>
  fetchGasApi("nfbExecuteBatchGoogleDocOutput", payload, "一括様式出力に失敗しました");

// 検索結果一覧の更新時などに付帯的に呼ぶ。期限切れソフトデリート行の purge を起動する。
// 失敗してもメインのリフレッシュは継続させる前提（呼び出し側で握りつぶす）。
export const runPurgeCheck = ({ formId } = {}) =>
  fetchGasApi("nfbRunPurgeCheck", { formId }, "期限切れレコードの整理に失敗しました");

export const syncRecordsProxy = async (payload) => {
  if (!payload?.formId) throw new Error("formId is required");
  const result = await fetchGasApi("syncRecordsProxy", { ...payload }, "Sync failed");
  return result;
};
