/**
 * codeHandlers.gs
 * アクションハンドラ・シリアライズ・CORS
 */

function ListRecordsAction_(ctx) {
  const result = ListRecords_(ctx);
  if (result?.records) result.records = result.records.map(SerializeRecord_);
  return result;
}

function SerializeValue_(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SerializeDateLike_(value, options = {}) {
  const date = Sheets_parseDateLikeToJstDate_(value, options.allowSerialNumber);
  return date ? { iso: date.toISOString(), unixMs: Sheets_toUnixMs_(date) } : { iso: SerializeValue_(value), unixMs: null };
}

function SerializeRecord_(record) {
  const serializedData = {};
  const serializedDataUnixMs = {};
  const unixMsOrFallback = (value, fallbackEmpty = "") => {
    const unixMs = Sheets_toUnixMs_(value, true);
    if (Number.isFinite(unixMs)) return unixMs;
    if (value === null || value === undefined || value === "") return fallbackEmpty;
    return String(value);
  };
  const unixMsNullableOrFallback = (value) => {
    const unixMs = Sheets_toUnixMs_(value, true);
    if (Number.isFinite(unixMs)) return unixMs;
    if (value === null || value === undefined || value === "") return null;
    return String(value);
  };

  if (record.data && typeof record.data === "object") {
    Object.entries(record.data).forEach(([key, value]) => {
      const dateInfo = SerializeDateLike_(value);
      serializedData[key] = dateInfo.iso;
      if (dateInfo.unixMs !== null) serializedDataUnixMs[key] = dateInfo.unixMs;
    });
  }

  const createdInfo = SerializeDateLike_(record.createdAt, { allowSerialNumber: true });
  const modifiedInfo = SerializeDateLike_(record.modifiedAt, { allowSerialNumber: true });
  const deletedAtUnixMs = Sheets_toUnixMs_(record.deletedAt, true);

  return {
    id: String(record.id || ""),
    driveFolderUrl: record.driveFolderUrl || "",
    "No.": record["No."] ?? "",
    modifiedBy: record.modifiedBy || "",
    createdBy: record.createdBy || "",
    deletedBy: record.deletedBy || "",
    createdAt: unixMsOrFallback(record.createdAt, ""),
    modifiedAt: unixMsOrFallback(record.modifiedAt, ""),
    deletedAt: unixMsNullableOrFallback(record.deletedAt),
    createdAtUnixMs: createdInfo.unixMs,
    modifiedAtUnixMs: modifiedInfo.unixMs,
    deletedAtUnixMs,
    data: serializedData,
    dataUnixMs: serializedDataUnixMs
  };
}


function ExecuteWithSheet_(ctx, actionFn) {
  let sheet;
  try {
    sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  } catch (err) {
    return { ok: false, error: Sheets_translateOpenError_(err, ctx.spreadsheetId) };
  }
  return actionFn(sheet);
}

function BuildLockTimeoutResult_(actionLabel) {
  return {
    ok: false,
    code: NFB_ERROR_CODE_LOCK_TIMEOUT,
    error: `${actionLabel}処理は現在、他のユーザーによる更新中のため実行できませんでした。しばらくしてから再度お試しください。`,
  };
}

function WithScriptLock_(actionLabel, actionFn) {
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(NFB_LOCK_WAIT_TIMEOUT_MS);
  if (!locked) return BuildLockTimeoutResult_(actionLabel);

  try {
    return actionFn();
  } finally {
    try {
      SpreadsheetApp.flush();
    } catch (flushErr) {
      Logger.log(`[WithScriptLock_] SpreadsheetApp.flush failed: ${flushErr}`);
    }
    lock.releaseLock();
  }
}


function ResolveDeletedRecordRetentionDays_(ctx) {
  var rawDays = parseInt(ctx?.raw?.deletedRetentionDays, 10);
  if (isFinite(rawDays) && rawDays > 0) return rawDays;

  var formId = ctx?.raw?.formId;
  if (formId) {
    try {
      var form = Forms_getForm_(formId);
      var formDays = parseInt(form?.settings?.deletedRetentionDays, 10);
      if (isFinite(formDays) && formDays > 0) return formDays;
    } catch (error) {
      Logger.log("[ResolveDeletedRecordRetentionDays_] Failed to load form setting: " + error);
    }
  }

  return Nfb_getDeletedRecordRetentionDays_();
}

function ResolveTemporalTypeMap_(ctx) {
  if (ctx?.raw?.formSchema && Array.isArray(ctx.raw.formSchema)) {
    return Sheets_collectTemporalPathMap_(ctx.raw.formSchema);
  }
  var formId = ctx?.raw?.formId;
  if (!formId) return null;
  try {
    var form = Forms_getForm_(formId);
    if (form?.schema && Array.isArray(form.schema)) {
      return Sheets_collectTemporalPathMap_(form.schema);
    }
  } catch (error) {
    Logger.log("[ResolveTemporalTypeMap_] Failed to load schema: " + error);
  }
  return null;
}

function SubmitResponses_(ctx) {
  return ExecuteWithSheet_(ctx, (sheet) => {
    return WithScriptLock_("保存", () => {
      const temporalTypeMap = ResolveTemporalTypeMap_(ctx);
      Sheets_purgeExpiredDeletedRows_(sheet, ResolveDeletedRecordRetentionDays_(ctx));
      const result = Sheets_upsertRecordById_(sheet, ctx.order, ctx, temporalTypeMap);
      return {
        ok: true,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ctx.spreadsheetId}`,
        sheetName: ctx.sheetName,
        rowNumber: result.row,
        id: result.id,
        recordNo: result.recordNo,
      };
    });
  });
}

function AcquireSaveLock_(ctx) {
  return ExecuteWithSheet_(ctx, (_sheet) => {
    return WithScriptLock_("保存", () => ({ ok: true }));
  });
}

function DeleteRecord_(ctx) {
  const idErr = RequireRecordId_(ctx);
  if (idErr) return idErr;
  return ExecuteWithSheet_(ctx, (sheet) => {
    const result = Sheets_deleteRecordById_(sheet, ctx.id);
    if (!result.ok) return result;
    return { ok: true, id: ctx.id, deletedRow: result.row };
  });
}

function GetRecord_(ctx) {
  const idErr = RequireRecordId_(ctx);
  if (idErr) return idErr;
  return ExecuteWithSheet_(ctx, (sheet) => {
    const result = Sheets_getRecordById_(sheet, ctx.id, ctx.rowIndexHint);
    if (!result?.ok) return result || { ok: false, error: "Record not found" };
    return { ok: true, record: result.record ? SerializeRecord_(result.record) : null, rowIndex: result.rowIndex };
  });
}

function ListRecords_(ctx) {
  return ExecuteWithSheet_(ctx, (sheet) => {
    const toComparableUnixMs = (value, allowSerialNumber) => {
      if (value === null || value === undefined || value === "") return 0;
      if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : 0;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        const normalized = Sheets_normalizeNumericToUnixMs_(value, allowSerialNumber);
        return Number.isFinite(normalized) ? normalized : 0;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return 0;
        if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) {
          const normalized = Sheets_normalizeNumericToUnixMs_(parseFloat(trimmed), allowSerialNumber);
          return Number.isFinite(normalized) ? normalized : 0;
        }
        const normalized = Sheets_toUnixMs_(trimmed, allowSerialNumber);
        if (Number.isFinite(normalized)) return normalized;
      }
      const normalized = Sheets_toUnixMs_(value, allowSerialNumber);
      return Number.isFinite(normalized) ? normalized : 0;
    };

    const listRecords = () => {
      let temporalTypeMap = null;
      const formId = ctx?.raw?.formId;
      if (formId) {
        try {
          const form = Forms_getForm_(formId);
          if (form?.schema) temporalTypeMap = Sheets_collectTemporalPathMap_(form.schema);
        } catch (err) {
          Logger.log(`[ListRecords_] Failed to load form schema for temporal formats: ${err}`);
        }
      }

      const sheetLastUpdatedAt = Sheets_readSheetLastUpdated_(sheet);
      const shouldNormalize = Boolean(ctx.forceFullSync) || !ctx.lastSpreadsheetReadAt;
      const allRecords = Sheets_getAllRecords_(sheet, temporalTypeMap, { normalize: shouldNormalize });
      const headerMatrix = Sheets_readHeaderMatrix_(sheet);

      if (ctx.forceFullSync || !ctx.lastSpreadsheetReadAt) {
        return {
          ok: true,
          records: allRecords,
          count: allRecords.length,
          headerMatrix,
          isDelta: false,
          sheetLastUpdatedAt,
        };
      }

      const lastSpreadsheetReadAtUnixMs = toComparableUnixMs(ctx.lastSpreadsheetReadAt, false);
      if (sheetLastUpdatedAt > 0 && lastSpreadsheetReadAtUnixMs > 0 && sheetLastUpdatedAt <= lastSpreadsheetReadAtUnixMs) {
        return {
          ok: true,
          records: [],
          count: 0,
          headerMatrix,
          isDelta: true,
          sheetLastUpdatedAt,
        };
      }

      const updatedRecords = [];
      for (let i = 0; i < allRecords.length; i += 1) {
        const rec = allRecords[i];
        const modifiedAtUnixMs = toComparableUnixMs(rec.modifiedAtUnixMs, true) || toComparableUnixMs(rec.modifiedAt, true);
        if (modifiedAtUnixMs > lastSpreadsheetReadAtUnixMs) {
          updatedRecords.push(rec);
        }
      }

      return {
        ok: true,
        records: updatedRecords,
        count: updatedRecords.length,
        headerMatrix,
        isDelta: true,
        sheetLastUpdatedAt,
      };
    };

    return listRecords();
  });
}

function handleCors_(e, handler) {
  const origin = e?.headers?.origin || "*";
  if (e?.method === "OPTIONS") return Cors_applyHeaders_(ContentService.createTextOutput(""), origin, true);
  return Cors_applyHeaders_(handler(), origin, false);
}

function Cors_applyHeaders_(output, origin, isPreflight) {
  output.setHeader("Access-Control-Allow-Origin", origin || "*");
  output.setHeader("Access-Control-Allow-Credentials", "true");
  if (isPreflight) {
    output.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    output.setHeader("Access-Control-Allow-Headers", "Content-Type");
    output.setHeader("Access-Control-Max-Age", "3600");
  }
  return output;
}

function FormsApi_List_(ctx) {
  const result = nfbListForms({ includeArchived: !!ctx.raw?.includeArchived });
  if (!result?.ok) return { ok: false, error: result?.error || "フォーム一覧の取得に失敗しました" };
  return { ok: true, forms: result.forms || [], count: (result.forms || []).length, loadFailures: result.loadFailures || [] };
}

function FormsApi_Get_(ctx) {
  if (!ctx.raw?.formId) return { ok: false, error: "フォームIDが指定されていません" };
  const result = nfbGetForm(ctx.raw.formId);
  if (!result?.ok || !result.form) return { ok: false, error: result?.error || "フォームの取得に失敗しました" };
  return { ok: true, form: result.form };
}

function FormsApi_Create_(ctx) {
  if (!ctx.raw?.formData?.id) return { ok: false, error: "フォームデータが不正です" };
  const result = nfbSaveForm({ form: ctx.raw.formData, targetUrl: ctx.raw.saveUrl || null });
  if (!result?.ok) return { ok: false, error: result?.error || "フォームの作成に失敗しました" };
  return { ok: true, form: result.form, fileUrl: result.fileUrl || null };
}

function FormsApi_Import_(ctx) {
  if (!ctx.raw?.fileUrl) return { ok: false, error: "ファイルURLが指定されていません" };
  const parsed = Forms_parseGoogleDriveUrl_(ctx.raw.fileUrl);
  if (parsed?.type !== "file" || !parsed.id) return { ok: false, error: "無効なファイルURLです" };

  let formData;
  try {
    const file = DriveApp.getFileById(parsed.id);
    formData = JSON.parse(file.getBlob().getDataAsString());
    formData.driveFileUrl = formData.driveFileUrl || file.getUrl();
  } catch (error) {
    return { ok: false, error: `フォームデータの取得に失敗しました: ${nfbErrorToString_(error)}` };
  }
  if (!formData?.id) return { ok: false, error: "フォームデータが不正です（idが必要です）" };

  const result = nfbSaveForm({ form: formData });
  if (!result?.ok) return { ok: false, error: result?.error || "フォームのインポートに失敗しました" };
  return { ok: true, form: result.form, fileUrl: result.fileUrl || null };
}

function FormsApi_Update_(ctx) {
  if (!ctx.raw?.formId || !ctx.raw?.updates) return { ok: false, error: "フォームIDまたは更新内容が指定されていません" };
  const currentResult = nfbGetForm(ctx.raw.formId);
  if (!currentResult?.ok || !currentResult.form) return { ok: false, error: currentResult?.error || "フォームが見つかりません" };

  const nextForm = { ...currentResult.form, ...ctx.raw.updates, id: ctx.raw.formId, createdAt: currentResult.form.createdAt, createdAtUnixMs: currentResult.form.createdAtUnixMs };
  const saveResult = nfbSaveForm({ form: nextForm });
  if (!saveResult?.ok) return { ok: false, error: saveResult?.error || "フォームの更新に失敗しました" };
  return { ok: true, form: saveResult.form };
}

function FormsApi_Delete_(ctx) {
  if (!ctx.raw?.formId) return { ok: false, error: "フォームIDが指定されていません" };
  const result = nfbDeleteForm(ctx.raw.formId);
  if (!result?.ok) return { ok: false, error: result?.error || "フォームの削除に失敗しました" };
  return { ok: true, message: "フォームを削除しました", formId: ctx.raw.formId };
}

function FormsApi_SetArchived_(ctx) {
  if (!ctx.raw?.formId || ctx.raw?.archived === undefined) return { ok: false, error: "フォームIDまたはアーカイブ状態が指定されていません" };
  const archivedFlag = ["true", true, 1, "1"].includes(ctx.raw.archived);
  const result = archivedFlag ? nfbArchiveForm(ctx.raw.formId) : nfbUnarchiveForm(ctx.raw.formId);
  if (!result?.ok) return { ok: false, error: result?.error || "フォームの更新に失敗しました" };
  return { ok: true, form: result.form || null };
}

function FormsApi_SetReadOnly_(ctx) {
  if (!ctx.raw?.formId || ctx.raw?.readOnly === undefined) return { ok: false, error: "フォームIDまたは参照のみ状態が指定されていません" };
  const readOnlyFlag = ["true", true, 1, "1"].includes(ctx.raw.readOnly);
  const result = readOnlyFlag ? nfbSetFormReadOnly(ctx.raw.formId) : nfbClearFormReadOnly(ctx.raw.formId);
  if (!result?.ok) return { ok: false, error: result?.error || "フォームの更新に失敗しました" };
  return { ok: true, form: result.form || null };
}
