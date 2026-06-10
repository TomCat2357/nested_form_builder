import { getRegisteredFormPid } from "./formPidContext.js";

export const hasScriptRun = () => typeof google !== "undefined" && google?.script?.run;

// URL で指定された pid（親レコード ID）。doGet が window.__PID__ に、固定フォーム ID を
// window.__FORM_ID__ に注入する。pid は「formid（?form=）と pid（?pid=）の両方が指定された
// ときだけ」有効化する設計のため、__FORM_ID__ が非空のときのみ pid を返す。フォームが URL で
// 固定されていない（管理画面など）状態で pid が紛れ込んでも、従来どおり全件・刻印なしのままにする。
// 有効時はレコード系 API へ自動付与し、サーバ側で「その pid に等しい行」だけを返させ、新規行には
// その pid を必ず刻ませる。
//
// 引数 formId を渡した場合は「その呼び出し先フォームが URL 固定フォーム（__FORM_ID__）と一致
// するときだけ」グローバル pid を適用する（子フォームのオーバーレイ等、別フォームへの呼び出しに
// 親タブの pid が紛れ込まないようにする）。formId 省略時は従来どおり（__FORM_ID__ 非空なら適用）。
export const getUrlPid = (formId) => {
  if (typeof window === "undefined") return "";
  // フォームが URL で固定されていない（__FORM_ID__ 空）ときは pid を無効化する。
  const urlFormId = window.__FORM_ID__;
  if (urlFormId === undefined || urlFormId === null || String(urlFormId).trim() === "") return "";
  if (formId !== undefined && String(formId).trim() !== String(urlFormId).trim()) return "";
  const raw = window.__PID__;
  return raw === undefined || raw === null ? "" : String(raw).trim();
};

// payload.formId に対する pid を解決して { pid } を付与する。
// 1) formPidContext に明示登録があれば最優先（子フォームのオーバーレイ文脈）。
// 2) 無ければ URL グローバル（__FORM_ID__ と payload.formId が一致するときの __PID__）。
// どちらも空なら payload をそのまま返す。payload.formId をキーに解決するので、親子が同時に
// マウントされていても呼び出し先ごとに正しい pid を引ける。
const withUrlPid = (payload) => {
  const formId = payload && payload.formId;
  const pid = getRegisteredFormPid(formId) || getUrlPid(formId);
  return pid ? { ...payload, pid } : payload;
};

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
  validateFormId(formId);
  return fetchGasApi("saveResponses", withUrlPid({ ...payload, formId, sheetName }), "Apps Script call failed");
};

export const acquireSaveLock = ({ formId, sheetName = "Data" }) => {
  validateFormId(formId);
  return fetchGasApi("nfbAcquireSaveLock", { formId, sheetName }, "Apps Script call failed");
};

export const deleteEntry = ({ formId, sheetName = "Data", entryId }) => {
  validateFormId(formId);
  if (!entryId) throw new Error("entryId is required");
  return fetchGasApi("deleteRecord", { formId, sheetName, id: entryId }, "Delete failed");
};

export const getEntry = async ({ formId, sheetName = "Data", entryId, rowIndexHint = null }) => {
  validateFormId(formId);
  if (!entryId) throw new Error("entryId is required");
  const result = await fetchGasApi("getRecord", withUrlPid({ formId, sheetName, id: entryId, rowIndexHint }), "Get record failed");
  return { record: result.record || null, rowIndex: typeof result.rowIndex === "number" ? result.rowIndex : null };
};

export const listEntries = async ({ sheetName = "Data", formId = null, lastSpreadsheetReadAt = null, forceFullSync = false }) => {
  validateFormId(formId);
  const normalizedLastSpreadsheetReadAt = Number(lastSpreadsheetReadAt);
  const payload = {
    sheetName,
    formId,
    forceFullSync: !!forceFullSync,
  };
  if (!forceFullSync && Number.isFinite(normalizedLastSpreadsheetReadAt) && normalizedLastSpreadsheetReadAt > 0) {
    payload.lastSpreadsheetReadAt = normalizedLastSpreadsheetReadAt;
  }
  const result = await fetchGasApi("listRecords", withUrlPid(payload), "スプレッドシートからデータ一覧を読み取れませんでした");
  return {
    records: result.records || [],
    headerMatrix: result.headerMatrix || [],
    isDelta: !!result.isDelta,
    allIds: Array.isArray(result.allIds) ? result.allIds : null,
    count: Number.isFinite(result.count) ? result.count : (result.records || []).length,
    sheetLastUpdatedAt: Number.isFinite(result.sheetLastUpdatedAt) ? result.sheetLastUpdatedAt : 0,
  };
};

// listRecords を「明示 pid + 全件」で叩く内部ヘルパ。URL の window.__PID__ には依存せず、
// 引数で渡した pid をそのまま payload に乗せてサーバ側フィルタさせる（withUrlPid を通さない）。
// formLink 子レコードの件数取得・コピー複製のように、現在の URL とは別フォーム/別 pid を
// 対象にしたいときに使う。pid が空なら呼ばずに空を返す。
const listRecordsByPidRaw_ = async ({ formId, pid, sheetName = "Data" }) => {
  validateFormId(formId);
  const normalizedPid = String(pid || "").trim();
  if (!normalizedPid) return { records: [], count: 0 };
  const result = await fetchGasApi(
    "listRecords",
    { sheetName, formId, forceFullSync: true, pid: normalizedPid },
    "子レコードの取得に失敗しました",
  );
  const records = result.records || [];
  return {
    records,
    count: Number.isFinite(result.count) ? result.count : records.length,
  };
};

// 指定フォーム（formId）で pid に一致するレコード件数を返す。子レコードの件数バッジ用。
export const countRecordsByPid = async (args) => (await listRecordsByPidRaw_(args)).count;

// 指定フォーム（formId）で pid に一致するレコード配列を返す。子レコードのコピー複製用。
export const listRecordsByPid = async (args) => (await listRecordsByPidRaw_(args)).records;

// 複数の pid を一括（WHERE pid IN (...) 相当）で取得する。検索結果一覧から「行 × 子フォーム数」で
// 膨らむのを避けるため、子フォームごとに 1 回だけ叩いてフロントで pid 分配する用途。
// pids が空なら呼ばずに空配列を返す。各レコードは .pid を持つので呼び出し側で groupBy する。
const listRecordsByPidsRaw_ = async ({ formId, pids, sheetName = "Data" }) => {
  validateFormId(formId);
  const normalizedPids = Array.from(
    new Set((Array.isArray(pids) ? pids : []).map((p) => String(p || "").trim()).filter(Boolean)),
  );
  if (normalizedPids.length === 0) return { records: [], count: 0 };
  const result = await fetchGasApi(
    "listRecords",
    { sheetName, formId, forceFullSync: true, pids: normalizedPids },
    "子レコードの取得に失敗しました",
  );
  const records = result.records || [];
  return {
    records,
    count: Number.isFinite(result.count) ? result.count : records.length,
  };
};

// 指定フォーム（formId）で pids のいずれかに一致するレコード配列を返す。一括子レコード取得用。
export const listRecordsByPids = async (args) => (await listRecordsByPidsRaw_(args)).records;

export const listForms = async (options = {}) => {
  const r = await fetchGasApi("nfbListForms", options, "List forms failed");
  return { forms: r.forms || [], loadFailures: r.loadFailures || [], folders: r.folders || [] };
};
export const listFolders = async () => {
  const r = await fetchGasApi("nfbListFolders", {}, "List folders failed");
  return { folders: r.folders || [] };
};
// 印刷様式テンプレート一覧（05_report_templates 配下の Google ドキュメント）を取得する。
export const listReportTemplates = async () => {
  const r = await fetchGasApi("nfbListReportTemplates", {}, "List report templates failed");
  return { files: r.files || [], truncated: !!r.truncated };
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
  validateFormId(formId);
  const r = await fetchGasApi("nfbGetForm", formId, "Get form failed");
  return r.form || null;
};
export const saveForm = async (form, saveMode = "auto") => {
  // id 省略/空は「新規ファイル作成」を意味する（GAS Forms_saveForm_ が空 id を新規作成として扱う）。
  // オフラインファーストのバックグラウンドアップロードでは新規フォームを id 無しで送るため、
  // ここで id 必須にはしない。
  if (!form) throw new Error("Form data is required");
  const r = await fetchGasApi("nfbSaveForm", { form, saveMode }, "Save form failed");
  return { form: r.form, fileUrl: r.fileUrl };
};
export const copyForm = async (formId) => {
  validateFormId(formId);
  const r = await fetchGasApi("nfbCopyForm", formId, "Copy form failed");
  return { form: r.form, fileUrl: r.fileUrl };
};
export const deleteFormFromDrive = createGasEndpoint({ fnName: "nfbDeleteForm", validate: validateFormId, defaultError: "Delete form failed" });
export const deleteFormsFromDrive = createGasEndpoint({ fnName: "nfbDeleteForms", validate: validateFormIds, defaultError: "Batch delete forms failed" });
// リンク解除＋プロジェクト内ファイルはゴミ箱へ移動（プロジェクト外は実体を残す）。
export const deleteFormsWithFiles = createGasEndpoint({ fnName: "nfbDeleteFormsWithFiles", validate: validateFormIds, defaultError: "Batch delete forms (with files) failed" });
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
// 標準フォルダ構成（システムごとコピー / マッピング再構築）
export const copyStandardFolders = async ({ destRootUrl, copyData = false, copyWebhooks = false, rebuildMapping = true } = {}) => {
  if (!destRootUrl) throw new Error("コピー先プロジェクトフォルダの URL を指定してください");
  const r = await fetchGasApi("nfbCopyStandardFolders", { destRootUrl, copyData, copyWebhooks, rebuildMapping }, "システムごとコピーに失敗しました");
  return { destRootUrl: r.destRootUrl || "", summary: r.summary || {}, clearedLinks: r.clearedLinks || 0, unresolvedQuestionLinks: r.unresolvedQuestionLinks || 0, rebuildMapping: Boolean(r.rebuildMapping), appsScriptCopied: Boolean(r.appsScriptCopied), appsScriptCopyError: r.appsScriptCopyError || "", message: r.message || "" };
};
// 現在のマッピングを _nfb_mapping.json 形のドキュメントで取得（ダウンロード用）。
export const exportMapping = async () => {
  const r = await fetchGasApi("nfbExportMapping", {}, "マッピングのエクスポートに失敗しました");
  return r.mapping;
};
// マッピングをインポート（マージ）。url 非空ならその Drive ファイル、空ならルート直下の最新 .json を読む。
// インポートは純粋なマージのみ。取り込んだエントリの物理整列・リンク修復は、各エンティティの次回保存時のサーバ側自動リンク補完が担う。
export const importMapping = async (url = "") => {
  const r = await fetchGasApi("nfbImportMapping", { url }, "マッピングのインポートに失敗しました");
  return { imported: r.imported || {}, skipped: r.skipped || 0, errors: r.errors || [] };
};
// 現在解決されるプロジェクトフォルダ情報を取得（診断用）。
export const getStdFolderRoot = async () => {
  const r = await fetchGasApi("nfbGetStdFolderRoot", {}, "プロジェクトフォルダの取得に失敗しました");
  return { resolved: Boolean(r.resolved), rootUrl: r.rootUrl || "", rootName: r.rootName || "", rootId: r.rootId || "", error: r.error || "" };
};
// 標準フォルダ構成（01_forms〜08_documents）を今すぐ全て作成。rootUrl 非空なら手動指定。
export const ensureStdFolders = async (rootUrl = "") => {
  const r = await fetchGasApi("nfbEnsureStdFolders", { rootUrl }, "標準フォルダ構成の作成に失敗しました");
  return { rootUrl: r.rootUrl || "", rootName: r.rootName || "" };
};
// 登録済みフォーム・Question・Dashboard を全件整列（物理位置 ↔ 論理パスの照合・move/copy・参照再リンク）。冪等。
export const alignAllStdFolders = async () => {
  const r = await fetchGasApi("nfbAlignAllStdFolders", {}, "標準フォルダ整列に失敗しました");
  const z = { aligned: 0, moved: 0, copiedExternal: 0, rekeyed: 0, errors: 0 };
  return {
    forms: { ...z, ...(r.forms || {}) },
    questions: { ...z, ...(r.questions || {}) },
    dashboards: { ...z, ...(r.dashboards || {}) },
    relinkedFiles: r.relinkedFiles || 0,
    errors: r.errors || [],
  };
};
// 注: 参照の再リンク / 同名重複整理は保存時のサーバ側自動リンク補完（alignReferencesOnSave_）が担う。
export const saveExcelToDrive = ({ filename, base64 }) => fetchGasApi("nfbSaveExcelToDrive", { filename, base64 }, "Driveへの保存に失敗しました");
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
  const result = await fetchGasApi("syncRecordsProxy", withUrlPid({ ...payload }), "Sync failed");
  return result;
};
