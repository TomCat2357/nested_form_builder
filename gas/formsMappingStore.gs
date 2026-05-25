// =============================================
// Forms Mapping Store — formId -> { fileId, driveFileUrl, title } を
// PropertiesService に { version, mapping } 形で永続化する。
// =============================================

function Forms_getActiveProps_() {
  return Nfb_getActiveProperties_();
}

/**
 * プロパティから現在のフォームマッピングを取得し、各エントリを正規化して返す。
 * @return {Object} formId -> { fileId, driveFileUrl, title }
 */
function Forms_getMapping_() {
  var props = Forms_getActiveProps_();
  var rawJson = props.getProperty(FORMS_PROPERTY_KEY);
  var mode = Nfb_getPropertyStoreMode_();
  Logger.log("[Forms_getMapping_] Raw JSON (" + mode + "): " + rawJson);

  var mapping = Nfb_parseVersionedMapping_(rawJson, FORMS_PROPERTY_VERSION, mode);
  var normalized = Forms_normalizeMapping_(mapping);

  Logger.log("[Forms_getMapping_] Returning mapping: " + JSON.stringify(normalized));
  return normalized;
}

/**
 * fileId から Google Drive のファイル表示用 URL を組み立てる。
 * @param {string} fileId
 * @return {string|null}
 */
function Forms_buildDriveFileUrlFromId_(fileId) {
  if (!fileId) return null;
  return "https://drive.google.com/file/d/" + fileId + "/view";
}

/**
 * マッピング値を正規化（v2: { fileId, driveFileUrl, title }）。
 * @param {*} value
 * @returns {{fileId: string|null, driveFileUrl: string|null, title: string|null}}
 */
function Forms_normalizeMappingValue_(value) {
  var fileId = null;
  var driveFileUrl = null;
  var title = null;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    fileId = typeof value.fileId === "string" ? String(value.fileId).trim() : null;
    driveFileUrl = typeof value.driveFileUrl === "string" ? String(value.driveFileUrl).trim() : null;
    title = typeof value.title === "string" ? String(value.title) : null;
  }

  if (!driveFileUrl && fileId) {
    driveFileUrl = Forms_buildDriveFileUrlFromId_(fileId);
  }

  return { fileId: fileId, driveFileUrl: driveFileUrl, title: title };
}

/**
 * マッピング全体を正規化
 * @param {Object} mapping
 * @returns {Object} 正規化済みマッピング
 */
function Forms_normalizeMapping_(mapping) {
  var normalized = {};
  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    normalized[formId] = Forms_normalizeMappingValue_(mapping[formId]);
  }
  return normalized;
}

/**
 * プロパティサービスにフォームマッピングを保存
 * @param {Object} mapping - formId -> { fileId, driveFileUrl, title } のマッピング
 */
function Forms_saveMapping_(mapping) {
  var props = Forms_getActiveProps_();
  var normalized = Nfb_serializeVersionedMapping_(
    props,
    FORMS_PROPERTY_KEY,
    FORMS_PROPERTY_VERSION,
    mapping || {},
    Forms_normalizeMappingValue_
  );
  Logger.log("[Forms_saveMapping_] Saved successfully. Total forms: " + Object.keys(normalized || {}).length);
}

/**
 * スキーマから ID を除去（options/children 含む）
 * @param {Array} schema
 * @return {Array}
 */
function Forms_stripSchemaIds_(schema) {
  if (!Array.isArray(schema)) return [];
  return nfbStripSchemaIDs_(schema, { uiTempKeys: NFB_UI_TEMP_KEYS });
}
