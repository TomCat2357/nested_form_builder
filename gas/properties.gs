function Nfb_getPropertyStoreMode_() {
  var rawMode = Nfb_trimStr_(NFB_PROPERTY_STORE_MODE).toLowerCase();
  return rawMode === NFB_PROPERTY_STORE_MODE_SCRIPT ? NFB_PROPERTY_STORE_MODE_SCRIPT : NFB_PROPERTY_STORE_MODE_USER;
}

function Nfb_getScriptProperties_() {
  return PropertiesService.getScriptProperties();
}

function Nfb_getActiveProperties_() {
  return Nfb_getPropertyStoreMode_() === NFB_PROPERTY_STORE_MODE_USER
    ? PropertiesService.getUserProperties()
    : PropertiesService.getScriptProperties();
}

function Nfb_isAdminSettingsEnabled_() {
  return Nfb_getPropertyStoreMode_() === NFB_PROPERTY_STORE_MODE_SCRIPT;
}

/**
 * プロパティに保存された `{ version, mapping }` 形 JSON をパースして mapping を返す。
 * JSON が無い / 壊れている / version 不一致 / mapping が plain object でない場合は {} を返す。
 * forms / analytics のマッピングストア共通ヘルパー。
 * @param {string} json
 * @param {number} expectedVersion
 * @param {string} label  ログ用ラベル
 * @return {Object}
 */
function Nfb_parseVersionedMapping_(json, expectedVersion, label) {
  if (!json) return {};
  try {
    var parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    if (parsed.version !== expectedVersion) return {};
    if (!parsed.mapping || typeof parsed.mapping !== "object" || Array.isArray(parsed.mapping)) return {};
    return parsed.mapping;
  } catch (err) {
    Logger.log("[Nfb_parseVersionedMapping_] Failed to parse " + label + ": " + err);
    return {};
  }
}

/**
 * `{ version, mapping }` 形 JSON を組み立てて props に保存する共通ヘルパー。
 * forms / analytics の保存ループ重複を吸収。
 * @param {GoogleAppsScript.Properties.Properties} props
 * @param {string} key
 * @param {number} version
 * @param {Object} mapping
 * @param {Function} normalizeFn  各エントリを正規化する関数
 * @return {Object} 正規化後の mapping
 */
function Nfb_serializeVersionedMapping_(props, key, version, mapping, normalizeFn) {
  var normalized = {};
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    normalized[id] = normalizeFn(mapping[id] || {});
  }
  props.setProperty(key, JSON.stringify({ version: version, mapping: normalized }));
  return normalized;
}

function Nfb_buildSheetLastUpdatedKey_(spreadsheetId, sheetName) {
  var sid = Nfb_trimStr_(spreadsheetId);
  var sn = String(sheetName || NFB_DEFAULT_SHEET_NAME).trim() || NFB_DEFAULT_SHEET_NAME;
  return NFB_SHEET_LAST_UPDATED_AT_PREFIX + "::" + sid + "::" + sn;
}

function ExtractFileIdFromUrl_(url) {
  if (!url || typeof url !== "string") return null;
  var parsed = Forms_parseGoogleDriveUrl_(url);
  return parsed.type === "file" ? parsed.id : null;
}

function AddFormUrl_(formId, fileUrl) {
  try {
    if (!formId || !fileUrl) throw new Error("フォームIDまたはファイルURLが指定されていません");
    var fileId = ExtractFileIdFromUrl_(fileUrl);
    if (!fileId) throw new Error("無効なGoogle DriveファイルURLです");
    try { DriveApp.getFileById(fileId); } catch (e) { throw new Error("ファイルへのアクセス権限がありません: " + nfbErrorToString_(e)); }

    var mapping = Forms_getMapping_() || {};
    var existing = mapping[formId] || {};
    // 既存の title / 論理パス folder は維持する（URL だけ更新するために中央辞書の他フィールドを消さない）。
    mapping[formId] = {
      fileId: fileId || existing.fileId || null,
      driveFileUrl: fileUrl,
      title: (typeof existing.title === "string") ? existing.title : null,
      folder: (typeof existing.folder === "string") ? existing.folder : null
    };
    Forms_saveMapping_(mapping);
    return { ok: true, message: "フォームURLを追加しました", formId: formId, fileUrl: fileUrl, fileId: fileId };
  } catch (error) {
    throw new Error("フォームURLの追加に失敗しました: " + nfbErrorToString_(error));
  }
}

function GetFormUrl_(formId) {
  try {
    if (!formId || typeof Forms_getMapping_ !== "function") return null;
    var mapping = Forms_getMapping_();
    var entry = mapping ? mapping[formId] : null;
    if (entry && entry.driveFileUrl) return entry.driveFileUrl;
    if (entry && entry.fileId) {
      return typeof Forms_buildDriveFileUrlFromId_ === "function"
        ? Forms_buildDriveFileUrlFromId_(entry.fileId)
        : "https://drive.google.com/file/d/" + entry.fileId + "/view";
    }
    return null;
  } catch (error) {
    Logger.log("[GetFormUrl_] Error: " + nfbErrorToString_(error));
    return null;
  }
}

function GetServerModifiedAt_() {
  return parseInt(Nfb_getScriptProperties_().getProperty(NFB_SERVER_MODIFIED_AT) || "0", 10) || 0;
}

function SetServerModifiedAt_(value) {
  Nfb_getScriptProperties_().setProperty(NFB_SERVER_MODIFIED_AT, String(value));
}

function Nfb_getDeletedRecordRetentionDays_() {
  var raw = Nfb_getScriptProperties_().getProperty(NFB_DELETED_RECORD_RETENTION_DAYS_KEY);
  var numeric = parseInt(raw || "", 10);
  if (isFinite(numeric) && numeric > 0) return numeric;
  return NFB_DEFAULT_DELETED_RECORD_RETENTION_DAYS;
}

function GetSheetLastUpdatedAt_(spreadsheetId, sheetName) {
  var key = Nfb_buildSheetLastUpdatedKey_(spreadsheetId, sheetName);
  return parseInt(Nfb_getScriptProperties_().getProperty(key) || "0", 10) || 0;
}

function SetSheetLastUpdatedAt_(spreadsheetId, sheetName, value) {
  var key = Nfb_buildSheetLastUpdatedKey_(spreadsheetId, sheetName);
  var unixMs = Sheets_toUnixMs_(value, true);
  var normalized = Number.isFinite(unixMs) ? unixMs : Date.now();
  Nfb_getScriptProperties_().setProperty(key, String(normalized));
  return normalized;
}
