const Nfb_getPropertyStoreMode_ = () => {
  const rawMode = String(NFB_PROPERTY_STORE_MODE || "").trim().toLowerCase();
  return rawMode === NFB_PROPERTY_STORE_MODE_SCRIPT ? NFB_PROPERTY_STORE_MODE_SCRIPT : NFB_PROPERTY_STORE_MODE_USER;
};

const Nfb_getScriptProperties_ = () => PropertiesService.getScriptProperties();
const Nfb_getActiveProperties_ = () => Nfb_getPropertyStoreMode_() === NFB_PROPERTY_STORE_MODE_USER ? PropertiesService.getUserProperties() : PropertiesService.getScriptProperties();
const Nfb_isAdminSettingsEnabled_ = () => Nfb_getPropertyStoreMode_() === NFB_PROPERTY_STORE_MODE_SCRIPT;
const Nfb_buildSheetLastUpdatedKey_ = (spreadsheetId, sheetName) => `${NFB_SHEET_LAST_UPDATED_AT_PREFIX}::${String(spreadsheetId || "").trim()}::${String(sheetName || NFB_DEFAULT_SHEET_NAME).trim() || NFB_DEFAULT_SHEET_NAME}`;

const ExtractFileIdFromUrl_ = (url) => {
  if (!url || typeof url !== "string") return null;
  const parsed = Forms_parseGoogleDriveUrl_(url);
  return parsed.type === "file" ? parsed.id : null;
};


;


;

const AddFormUrl_ = (formId, fileUrl) => {
  try {
    if (!formId || !fileUrl) throw new Error("フォームIDまたはファイルURLが指定されていません");
    const fileId = ExtractFileIdFromUrl_(fileUrl);
    if (!fileId) throw new Error("無効なGoogle DriveファイルURLです");
    try { DriveApp.getFileById(fileId); } catch (e) { throw new Error(`ファイルへのアクセス権限がありません: ${nfbErrorToString_(e)}`); }

    const mapping = Forms_getMapping_() || {};
    mapping[formId] = { fileId: fileId || mapping[formId]?.fileId || null, driveFileUrl: fileUrl };
    Forms_saveMapping_(mapping);
    return { ok: true, message: "フォームURLを追加しました", formId, fileUrl, fileId };
  } catch (error) {
    throw new Error(`フォームURLの追加に失敗しました: ${nfbErrorToString_(error)}`);
  }
};

const GetFormUrl_ = (formId) => {
  try {
    if (!formId || typeof Forms_getMapping_ !== "function") return null;
    const entry = Forms_getMapping_()?.[formId];
    if (entry?.driveFileUrl) return entry.driveFileUrl;
    if (entry?.fileId) return typeof Forms_buildDriveFileUrlFromId_ === "function" ? Forms_buildDriveFileUrlFromId_(entry.fileId) : `https://drive.google.com/file/d/${entry.fileId}/view`;
    return null;
  } catch (error) {
    Logger.log(`[GetFormUrl_] Error: ${nfbErrorToString_(error)}`);
    return null;
  }
};

const GetServerModifiedAt_ = () => parseInt(Nfb_getScriptProperties_().getProperty(NFB_SERVER_MODIFIED_AT) || "0", 10) || 0;
const SetServerModifiedAt_ = (value) => Nfb_getScriptProperties_().setProperty(NFB_SERVER_MODIFIED_AT, String(value));

const Nfb_getDeletedRecordRetentionDays_ = () => {
  const raw = Nfb_getScriptProperties_().getProperty(NFB_DELETED_RECORD_RETENTION_DAYS_KEY);
  const numeric = parseInt(raw || "", 10);
  if (isFinite(numeric) && numeric > 0) return numeric;
  return NFB_DEFAULT_DELETED_RECORD_RETENTION_DAYS;
};
// backward compatibility
const GetServerCommitToken_ = () => GetServerModifiedAt_();
const SetServerCommitToken_ = (token) => SetServerModifiedAt_(token);
const GetSheetLastUpdatedAt_ = (spreadsheetId, sheetName) => {
  const key = Nfb_buildSheetLastUpdatedKey_(spreadsheetId, sheetName);
  return parseInt(Nfb_getScriptProperties_().getProperty(key) || "0", 10) || 0;
};
const SetSheetLastUpdatedAt_ = (spreadsheetId, sheetName, value) => {
  const key = Nfb_buildSheetLastUpdatedKey_(spreadsheetId, sheetName);
  const unixMs = Sheets_toUnixMs_(value, true);
  const normalized = Number.isFinite(unixMs) ? unixMs : Date.now();
  Nfb_getScriptProperties_().setProperty(key, String(normalized));
  return normalized;
};
