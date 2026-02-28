// Split from forms.gs



function Forms_getActiveProps_() {
  return Nfb_getActiveProperties_();
}

function Forms_parseMappingJson_(json, label) {
  if (!json) return {};
  try {
    var parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    if (parsed.version !== FORMS_PROPERTY_VERSION) return {};
    if (!parsed.mapping || typeof parsed.mapping !== "object" || Array.isArray(parsed.mapping)) return {};
    return parsed.mapping;
  } catch (err) {
    Logger.log("[Forms_parseMappingJson_] Failed to parse " + label + ": " + err);
    return {};
  }
}

/**
 * Google DriveのURLからIDを抽出
 * @param {string} url - Google DriveのURL
 * @return {Object} { type: "file"|"folder"|null, id: string|null }
 */

function Forms_getMapping_() {
  var props = Forms_getActiveProps_();
  var rawJson = props.getProperty(FORMS_PROPERTY_KEY);
  var mode = Nfb_getPropertyStoreMode_();
  Logger.log("[Forms_getMapping_] Raw JSON (" + mode + "): " + rawJson);

  var mapping = Forms_parseMappingJson_(rawJson, mode);
  var normalized = Forms_normalizeMapping_(mapping);

  Logger.log("[Forms_getMapping_] Returning mapping: " + JSON.stringify(normalized));
  return normalized;
}

function Forms_normalizeMappingValue_(value) {
  var fileId = null;
  var driveFileUrl = null;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    fileId = typeof value.fileId === "string" ? String(value.fileId).trim() : null;
    driveFileUrl = typeof value.driveFileUrl === "string" ? String(value.driveFileUrl).trim() : null;
  }

  if (!driveFileUrl && fileId) {
    driveFileUrl = Forms_buildDriveFileUrlFromId_(fileId);
  }

  return { fileId: fileId, driveFileUrl: driveFileUrl };
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
 * スキーマからIDを除去（options/children含む）
 * @param {Array} schema
 * @return {Array}
 */

function Forms_saveMapping_(mapping) {
  var normalized = Forms_normalizeMapping_(mapping || {});
  var mappingStr = JSON.stringify({ version: FORMS_PROPERTY_VERSION, mapping: normalized });
  Logger.log("[Forms_saveMapping_] Saving mapping: " + mappingStr);

  var props = Forms_getActiveProps_();
  props.setProperty(FORMS_PROPERTY_KEY, mappingStr);

  Logger.log("[Forms_saveMapping_] Saved successfully. Total forms: " + Object.keys(normalized || {}).length);
}

/**
 * formId配列を正規化（重複・空値を除外）
 * @param {Array<string>|string} formIds
 * @return {Array<string>}
 */

function Forms_normalizeFormIds_(formIds) {
  var source = Array.isArray(formIds) ? formIds : [formIds];
  var seen = {};
  var normalized = [];

  for (var i = 0; i < source.length; i++) {
    var rawId = source[i];
    if (!rawId) continue;
    var formId = String(rawId);
    if (seen[formId]) continue;
    seen[formId] = true;
    normalized.push(formId);
  }

  return normalized;
}

/**
 * フォーム保存用フォルダを取得または作成
 * @return {Folder}
 */

function Forms_buildDriveFileUrlFromId_(fileId) {
  if (!fileId) return null;
  return "https://drive.google.com/file/d/" + fileId + "/view";
}

/**
 * マッピング値を正規化（v2: { fileId, driveFileUrl }）
 * @param {*} value
 * @returns {{fileId: string|null, driveFileUrl: string|null}}
 */

function Forms_stripSchemaIds_(schema) {
  if (!schema || !schema.map) return [];

  var stripArray = function(arr) {
    return (arr || []).map(function(field) {
      var base = {};
      for (var key in field) {
        if (!field.hasOwnProperty(key)) continue;
        if (key === "id") continue; // フィールドIDは外部配布不要
        base[key] = field[key];
      }

      // optionsのIDを除去
      if (base.options && Array.isArray(base.options)) {
        base.options = base.options.map(function(opt) {
          var optBase = {};
          for (var optKey in opt) {
            if (!opt.hasOwnProperty(optKey)) continue;
            if (optKey === "id") continue;
            optBase[optKey] = opt[optKey];
          }
          return optBase;
        });
      }

      // childrenByValue のIDを除去
      if (base.childrenByValue && typeof base.childrenByValue === "object") {
        var fixed = {};
        for (var val in base.childrenByValue) {
          if (!base.childrenByValue.hasOwnProperty(val)) continue;
          fixed[val] = stripArray(base.childrenByValue[val]);
        }
        base.childrenByValue = fixed;
      }

      // 一時UI状態は保存対象外
      delete base._savedChoiceState;
      delete base._savedStyleSettings;
      delete base._savedChildrenForChoice;
      delete base._savedDisplayModeForChoice;

      return base;
    });
  };

  return stripArray(schema);
}

/**
 * プロパティサービスにフォームマッピングを保存
 * @param {Object} mapping - formId -> fileId のマッピング
 */
