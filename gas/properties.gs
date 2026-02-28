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

const GetFormUrls_ = () => {
  try {
    if (typeof Forms_getMapping_ !== "function") return {};
    const mapping = Forms_getMapping_() || {};
    const urlMap = {};
    Object.entries(mapping).forEach(([formId, entry]) => {
      let fileUrl = entry?.driveFileUrl || null;
      if (!fileUrl && entry?.fileId) {
        fileUrl = typeof Forms_buildDriveFileUrlFromId_ === "function"
          ? Forms_buildDriveFileUrlFromId_(entry.fileId)
          : `https://drive.google.com/file/d/${entry.fileId}/view`;
      }
      if (fileUrl) urlMap[formId] = fileUrl;
    });
    return urlMap;
  } catch (error) {
    Logger.log(`[GetFormUrls_] Error: ${nfbErrorToString_(error)}`);
    return {};
  }
};

const SaveFormUrls_ = (urlMap = {}) => {
  try {
    if (typeof Forms_getMapping_ !== "function" || typeof Forms_saveMapping_ !== "function") throw new Error("Forms mapping functions are unavailable");
    const mapping = Forms_getMapping_() || {};
    Object.entries(urlMap).forEach(([formId, fileUrl]) => {
      if (!fileUrl) return;
      mapping[formId] = { fileId: ExtractFileIdFromUrl_(fileUrl) || mapping[formId]?.fileId || null, driveFileUrl: fileUrl };
    });
    Forms_saveMapping_(mapping);
  } catch (error) {
    throw new Error(`フォームURLマップの保存に失敗しました: ${nfbErrorToString_(error)}`);
  }
};

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

const GetServerCommitToken_ = () => parseInt(Nfb_getScriptProperties_().getProperty(NFB_SERVER_COMMIT_TOKEN) || "0", 10) || 0;
const SetServerCommitToken_ = (token) => Nfb_getScriptProperties_().setProperty(NFB_SERVER_COMMIT_TOKEN, String(token));
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
