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

// data 列の値をワイヤ表現に変換する。
// Plan P4 γ: JSON ワイヤ / アプリ内部 / キャッシュは canonical 文字列のまま。
// Sheets_buildRecordFromRow_ が date/time/datetime セルを既に canonical 文字列化済みなので、
// ここでは万一 Date が直接来た場合だけ canonical 文字列へ正規化し、それ以外は従来どおり素通しする
//（= "14:50:00" を ISO に再パースして "1899-12-30T05:50:00.000Z" にしない）。
function SerializeDataValue_(value) {
  if (value instanceof Date) {
    const canonical = Sheets_sheetDateCellToCanonical_(value);
    return (typeof canonical === "string") ? canonical : value.toISOString();
  }
  return SerializeValue_(value);
}

function SerializeRecord_(record) {
  const serializedData = {};
  const serializedDataUnixMs = {};
  // 固定メタ列は Unix ms 厳密解釈（×1000 / Excel シリアル値の再解釈をしない）
  const unixMsOrFallback = (value, fallbackEmpty = "") => {
    const unixMs = Sheets_toStrictUnixMs_(value);
    if (Number.isFinite(unixMs)) return unixMs;
    if (value === null || value === undefined || value === "") return fallbackEmpty;
    return String(value);
  };
  const unixMsNullableOrFallback = (value) => {
    const unixMs = Sheets_toStrictUnixMs_(value);
    if (Number.isFinite(unixMs)) return unixMs;
    if (value === null || value === undefined || value === "") return null;
    return String(value);
  };

  if (record.data && typeof record.data === "object") {
    Object.entries(record.data).forEach(([key, value]) => {
      serializedData[key] = SerializeDataValue_(value);
    });
  }
  // dataUnixMs は Sheets_buildRecordFromRow_ が canonical 値から導出済み。数値だけ通す。
  if (record.dataUnixMs && typeof record.dataUnixMs === "object") {
    Object.entries(record.dataUnixMs).forEach(([key, value]) => {
      const unixMs = Number(value);
      if (Number.isFinite(unixMs)) serializedDataUnixMs[key] = unixMs;
    });
  }

  return {
    id: String(record.id || ""),
    "No.": record["No."] ?? "",
    modifiedBy: record.modifiedBy || "",
    createdBy: record.createdBy || "",
    deletedBy: record.deletedBy || "",
    pid: record.pid == null ? "" : String(record.pid),
    createdAt: unixMsOrFallback(record.createdAt, ""),
    modifiedAt: unixMsOrFallback(record.modifiedAt, ""),
    deletedAt: unixMsNullableOrFallback(record.deletedAt),
    createdAtUnixMs: Sheets_toStrictUnixMs_(record.createdAt),
    modifiedAtUnixMs: Sheets_toStrictUnixMs_(record.modifiedAt),
    deletedAtUnixMs: Sheets_toStrictUnixMs_(record.deletedAt),
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
      var form = Nfb_getFormCached_(formId);
      var formDays = parseInt(form?.settings?.deletedRetentionDays, 10);
      if (isFinite(formDays) && formDays > 0) return formDays;
    } catch (error) {
      Logger.log("[ResolveDeletedRecordRetentionDays_] Failed to load form setting: " + error);
    }
  }

  return Nfb_getDeletedRecordRetentionDays_();
}

// === ソフトデリート期限切れ行の purge 監視 ===
// 監視キー "purge:<formId>" の値 = 最古の未削除ソフトデリート行の発生日時(ISO) または ""。
// forms マッピングと同じプロパティストア(Nfb_getActiveProperties_)に保存し突合する。

function Nfb_getPurgeProps_() {
  return Nfb_getActiveProperties_();
}

function Nfb_purgeKey_(formId) {
  return "purge:" + formId;
}

// フォーム設定から records シートを開く。未設定/開けない場合は null。
function Nfb_openFormSheet_(form) {
  var spreadsheetId = Model_normalizeSpreadsheetId_(form && form.settings ? form.settings.spreadsheetId : "");
  if (!spreadsheetId) return null;
  var sheetName = (form && form.settings && form.settings.sheetName) ? form.settings.sheetName : NFB_DEFAULT_SHEET_NAME;
  try {
    return SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  } catch (err) {
    Logger.log("[Nfb_openFormSheet_] open failed: " + err);
    return null;
  }
}

function Nfb_resolveRetentionDaysFromForm_(form) {
  var formDays = parseInt(form && form.settings ? form.settings.deletedRetentionDays : "", 10);
  if (isFinite(formDays) && formDays > 0) return formDays;
  return Nfb_getDeletedRecordRetentionDays_();
}

// シートから最古のソフトデリート日時を再計算し、監視キーを更新する。
function Nfb_updatePurgeKeyFromSheet_(formId, sheet, props) {
  if (!formId) return;
  props = props || Nfb_getPurgeProps_();
  var oldest = Sheets_getOldestSoftDeletedDate_(sheet);
  props.setProperty(Nfb_purgeKey_(formId), oldest ? oldest.toISOString() : "");
}

// ソフトデリート発生時に呼ぶ。監視キーが未登録/空なら現在時刻で発生をマークする
// （既に値があれば最古を保持）。
function Nfb_registerSoftDeleteForPurge_(formId) {
  if (!formId) return;
  try {
    var props = Nfb_getPurgeProps_();
    var key = Nfb_purgeKey_(formId);
    var current = props.getProperty(key);
    if (current === null || current === "") {
      props.setProperty(key, new Date().toISOString());
    }
  } catch (err) {
    Logger.log("[Nfb_registerSoftDeleteForPurge_] " + err);
  }
}

// 該当フォーム1件分の purge チェック（シートを持っていない契機で使う）。
// 監視対象外(null)/未削除(空)/保持期間内なら何もしない。
function Nfb_runPurgeCheckForForm_(formId) {
  if (!formId) return;
  var props = Nfb_getPurgeProps_();
  var key = Nfb_purgeKey_(formId);
  var value = props.getProperty(key);
  if (value === null || value === "") return;

  var oldestMs = new Date(value).getTime();
  if (!isFinite(oldestMs)) {
    props.setProperty(key, "");
    return;
  }

  var form = Forms_getForm_(formId);
  if (!form) return;
  var retentionDays = Nfb_resolveRetentionDaysFromForm_(form);
  if (Date.now() - oldestMs < retentionDays * NFB_MS_PER_DAY) return;

  var sheet = Nfb_openFormSheet_(form);
  if (!sheet) {
    props.setProperty(key, "");
    return;
  }
  WithScriptLock_("purge", function() {
    Sheets_purgeExpiredDeletedRows_(sheet, retentionDays);
    Nfb_updatePurgeKeyFromSheet_(formId, sheet, props);
    return { ok: true };
  });
}

// 監視キー集合を forms マッピング(ソースオブトゥルース)と突合する。
// 新規フォーム: 初回スキャンして登録 / 削除済みフォーム: キー削除。
// シート走査 → setProperty のアトミック順序により、タイムアウトしても次回続きから再開できる。
function Nfb_syncPurgeKeysWithForms_() {
  var props = Nfb_getPurgeProps_();
  var mapping = Forms_getMapping_() || {};
  var prefix = "purge:";

  var watched = {};
  var allKeys = props.getKeys();
  for (var i = 0; i < allKeys.length; i++) {
    if (allKeys[i].indexOf(prefix) === 0) {
      watched[allKeys[i].substring(prefix.length)] = true;
    }
  }

  // 新規フォーム: mapping にあるが未監視
  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    if (watched[formId]) continue;
    try {
      var form = Forms_getForm_(formId);
      var sheet = form ? Nfb_openFormSheet_(form) : null;
      if (sheet) {
        var retentionDays = Nfb_resolveRetentionDaysFromForm_(form);
        WithScriptLock_("purge", function() {
          Sheets_purgeExpiredDeletedRows_(sheet, retentionDays);
          Nfb_updatePurgeKeyFromSheet_(formId, sheet, props);
          return { ok: true };
        });
      } else {
        props.setProperty(prefix + formId, "");
      }
    } catch (err) {
      Logger.log("[Nfb_syncPurgeKeysWithForms_] form " + formId + " failed: " + err);
      // 未登録のまま残す → 次回再試行
    }
  }

  // 削除済みフォーム: 監視されているが mapping に無い
  for (var watchedId in watched) {
    if (!mapping.hasOwnProperty(watchedId)) {
      props.deleteProperty(prefix + watchedId);
    }
  }
}

function RunPurgeCheck_(ctx) {
  var formId = (ctx && ctx.raw) ? ctx.raw.formId : "";
  Nfb_runPurgeCheckForForm_(formId);
  Nfb_syncPurgeKeysWithForms_();
  return { ok: true };
}

// ctx からフォームスキーマ配列を解決する（リクエスト同梱 formSchema 優先、無ければ formId でキャッシュ取得）。
function Nfb_resolveFormSchemaArray_(ctx) {
  if (ctx?.raw?.formSchema && Array.isArray(ctx.raw.formSchema)) {
    return ctx.raw.formSchema;
  }
  var formId = ctx?.raw?.formId;
  if (!formId) return null;
  try {
    var form = Nfb_getFormCached_(formId);
    if (form?.schema && Array.isArray(form.schema)) return form.schema;
  } catch (error) {
    Logger.log("[Nfb_resolveFormSchemaArray_] Failed to load schema: " + error);
  }
  return null;
}

function ResolveTemporalTypeMap_(ctx) {
  var schema = Nfb_resolveFormSchemaArray_(ctx);
  return schema ? Sheets_collectTemporalPathMap_(schema) : null;
}

function SubmitResponses_(ctx) {
  return ExecuteWithSheet_(ctx, (sheet) => {
    return WithScriptLock_("保存", () => {
      const schema = Nfb_resolveFormSchemaArray_(ctx);
      const temporalTypeMap = schema ? Sheets_collectTemporalPathMap_(schema) : null;
      const columnFormatMap = schema ? Sheets_collectColumnFormatMap_(schema) : null;
      Sheets_purgeExpiredDeletedRows_(sheet, ResolveDeletedRecordRetentionDays_(ctx));
      Nfb_updatePurgeKeyFromSheet_(ctx?.raw?.formId, sheet);
      // アップロード保存先フォルダを 06_upload_files へ寄せ、folderUrl/folderPath を両方刻む（外部=copy/内部=move、非致命）。
      try { StdFolders_normalizeUploadCellsInResponses_(ctx.responses); }
      catch (eUp) { Logger.log("[SubmitResponses_] normalizeUploadCells failed: " + nfbErrorToString_(eUp)); }
      const result = Sheets_upsertRecordById_(sheet, ctx.order, ctx, temporalTypeMap, columnFormatMap);
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
    Nfb_registerSoftDeleteForPurge_(ctx?.raw?.formId);
    return { ok: true, id: ctx.id, deletedRow: result.row };
  });
}

function GetRecord_(ctx) {
  const idErr = RequireRecordId_(ctx);
  if (idErr) return idErr;
  return ExecuteWithSheet_(ctx, (sheet) => {
    const result = Sheets_getRecordById_(sheet, ctx.id, ctx.rowIndexHint);
    if (!result?.ok) return result || { ok: false, error: "Record not found" };
    if (result.record && !Nfb_isAdminFromCtx_(ctx) && Nfb_isSoftDeletedRecord_(result.record)) {
      return { ok: false, error: "Record not found" };
    }
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
          const form = Nfb_getFormCached_(formId);
          if (form?.schema) temporalTypeMap = Sheets_collectTemporalPathMap_(form.schema);
        } catch (err) {
          Logger.log(`[ListRecords_] Failed to load form schema for temporal formats: ${err}`);
        }
      }

      const sheetLastUpdatedAt = Sheets_readSheetLastUpdated_(sheet);
      const shouldNormalize = Boolean(ctx.forceFullSync) || !ctx.lastSpreadsheetReadAt;
      const allRecords = Sheets_getAllRecords_(sheet, temporalTypeMap, { normalize: shouldNormalize });
      const headerMatrix = Sheets_readHeaderMatrix_(sheet);
      const isAdmin = Nfb_isAdminFromCtx_(ctx);
      // pids（配列）優先：検索一覧の一括子レコード取得（WHERE pid IN (...) 相当）。
      // pids が無ければ従来どおり単一 pid フィルタにフォールバック。読込パス専用で、
      // 新規行への pid 刻印（codeSyncRecords / sheetsRowOps）は単一 pid のまま不変。
      const pids = Nfb_resolvePidsFromCtx_(ctx);
      var pidFiltered;
      if (pids.length > 0) {
        const pidsSet = {};
        for (var pi = 0; pi < pids.length; pi++) pidsSet[pids[pi]] = true;
        pidFiltered = allRecords.filter((r) => Nfb_recordMatchesPids_(r, pidsSet));
      } else {
        const pid = Nfb_resolvePidFromCtx_(ctx);
        pidFiltered = pid ? allRecords.filter((r) => Nfb_recordMatchesPid_(r, pid)) : allRecords;
      }
      const visibleRecords = isAdmin
        ? pidFiltered
        : pidFiltered.filter((r) => !Nfb_isSoftDeletedRecord_(r));

      if (ctx.forceFullSync || !ctx.lastSpreadsheetReadAt) {
        return {
          ok: true,
          records: visibleRecords,
          count: visibleRecords.length,
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
      for (let i = 0; i < visibleRecords.length; i += 1) {
        const rec = visibleRecords[i];
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

function Nfb_isAdminFromCtx_(ctx) {
  try {
    return IsAdmin_((ctx && ctx.raw && ctx.raw.authKey) || "", ResolveActiveUserEmail_());
  } catch (err) {
    Logger.log("[Nfb_isAdminFromCtx_] failed: " + err);
    return false;
  }
}

// URL から渡された pid（親レコード ID）を ctx から取り出す。空文字/未指定なら "" を返す。
// pid が指定されている間は「その pid に等しい行」だけを返し、新規行にはその pid を必ず刻む。
function Nfb_resolvePidFromCtx_(ctx) {
  var raw = ctx && ctx.raw ? ctx.raw.pid : "";
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

// pid フィルタ適用後に残すべきレコードか判定する。pid が空なら全件許可（従来動作）。
function Nfb_recordMatchesPid_(record, pid) {
  if (!pid) return true;
  if (!record) return false;
  return String(record.pid == null ? "" : record.pid) === pid;
}

// URL/payload から渡された pids（親レコード ID の配列）を ctx から取り出す。
// 一括子レコード取得（WHERE pid IN (...) 相当）用。trim 済み非空文字列の配列を返す。
// 配列でない/未指定なら空配列（呼び出し側は単一 pid パスへフォールバック）。
function Nfb_resolvePidsFromCtx_(ctx) {
  var raw = ctx && ctx.raw ? ctx.raw.pids : null;
  if (!raw || !Array.isArray(raw)) return [];
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var v = raw[i];
    if (v === null || v === undefined) continue;
    var s = String(v).trim();
    if (s) out.push(s);
  }
  return out;
}

// pidsSet（{ pid: true }）のいずれかに一致するレコードか判定する。
function Nfb_recordMatchesPids_(record, pidsSet) {
  if (!record) return false;
  var key = String(record.pid == null ? "" : record.pid);
  return pidsSet[key] === true;
}

function Nfb_isSoftDeletedRecord_(record) {
  if (!record) return false;
  var unixMs = record.deletedAtUnixMs;
  if (typeof unixMs === "number" && isFinite(unixMs) && unixMs > 0) return true;
  var deletedAt = record.deletedAt;
  if (deletedAt === null || deletedAt === undefined || deletedAt === "") return false;
  return true;
}
