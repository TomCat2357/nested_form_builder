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
 * マッピング値正規化の共通コア。Forms（nameKey="title"）/ Analytics（nameKey="name"）で共有する。
 * folder は論理パス（中央辞書の第一級フィールド）。文字列なら正規化、未設定は null。
 * null は「未バックフィル」の sentinel（"" の「ルート」と区別する）。
 * driveFileUrl は欠落時 fileId から再構築する（forms / questions / dashboards で同一 URL 形式）。
 * @param {*} value
 * @param {string} nameKey ラベル文字列を格納するキー名（"title" or "name"）
 * @returns {{fileId: string|null, driveFileUrl: string|null, folder: string|null}} + [nameKey]
 */
function Nfb_normalizeMappingValue_(value, nameKey) {
  var fileId = null;
  var driveFileUrl = null;
  var name = null;
  var folder = null;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    fileId = typeof value.fileId === "string" ? String(value.fileId).trim() : null;
    driveFileUrl = typeof value.driveFileUrl === "string" ? String(value.driveFileUrl).trim() : null;
    name = typeof value[nameKey] === "string" ? String(value[nameKey]) : null;
    folder = typeof value.folder === "string" ? Forms_normalizeFolderPath_(value.folder) : null;
  }

  if (!driveFileUrl && fileId) {
    driveFileUrl = Forms_buildDriveFileUrlFromId_(fileId);
  }

  var out = {};
  out.fileId = fileId;
  out.driveFileUrl = driveFileUrl;
  out[nameKey] = name;
  out.folder = folder;
  return out;
}

/**
 * マッピング値を正規化（{ fileId, driveFileUrl, title, folder }）。Forms 用の薄いラッパー。
 * @param {*} value
 * @returns {{fileId: string|null, driveFileUrl: string|null, title: string|null, folder: string|null}}
 */
function Forms_normalizeMappingValue_(value) {
  return Nfb_normalizeMappingValue_(value, "title");
}

/**
 * 永続化用の最小化正規化の共通コア。Forms（nameKey="title"）/ Analytics（nameKey="name"）で共有する。
 * driveFileUrl は fileId から読取時に再構築できる（Nfb_normalizeMappingValue_）ため捨て、
 * { fileId, <nameKey>, folder } だけ残す。PropertiesService の容量制約に対し保存件数の上限を伸ばす。
 * <nameKey>（title/name）と論理パス folder は fileId 消失時に物理を探し直す復旧アンカーとして維持する
 * （folder の null sentinel＝未バックフィルもそのまま残す）。
 * @param {*} value
 * @param {string} nameKey ラベル文字列を格納するキー名（"title" or "name"）
 * @returns {{fileId: string|null, folder: string|null}} + [nameKey]
 */
function Nfb_minifyMappingForStorage_(value, nameKey) {
  var v = Nfb_normalizeMappingValue_(value, nameKey);
  var out = { fileId: v.fileId, folder: v.folder };
  out[nameKey] = v[nameKey];
  return out;
}

/**
 * 永続化用の最小化正規化。driveFileUrl は fileId から一意に導出でき（読取時に
 * Forms_normalizeMappingValue_ が再構築する）、1 エントリで最大のフィールドなので
 * 保存しない。PropertiesService の 9KB/値・500KB/合計 制約に対して件数限界を伸ばす。
 * fileId / title / folder は維持する（title は fileId 消失時に論理パスで物理を探し直す
 * 復旧アンカー）。読取側は従来どおり driveFileUrl 込みの完全なエントリを受け取る。
 * @param {*} value
 * @returns {{fileId: string|null, title: string|null, folder: string|null}}
 */
function Forms_normalizeMappingForStorage_(value) {
  return Nfb_minifyMappingForStorage_(value, "title");
}

/**
 * マッピング全体を正規化する共通コア。Forms（nameKey="title"）/ Analytics（nameKey="name"）で共有する。
 * @param {Object} mapping id -> 値
 * @param {string} nameKey ラベル文字列を格納するキー名（"title" or "name"）
 * @returns {Object} 正規化済みマッピング
 */
function Nfb_normalizeMapping_(mapping, nameKey) {
  var normalized = {};
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    normalized[id] = Nfb_normalizeMappingValue_(mapping[id], nameKey);
  }
  return normalized;
}

/**
 * マッピング全体を正規化。Forms 用の薄いラッパー（nameKey="title"）。
 * @param {Object} mapping
 * @returns {Object} 正規化済みマッピング
 */
function Forms_normalizeMapping_(mapping) {
  return Nfb_normalizeMapping_(mapping, "title");
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
    Forms_normalizeMappingForStorage_
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
