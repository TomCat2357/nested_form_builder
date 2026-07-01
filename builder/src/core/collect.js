import { ensureArray } from "../utils/arrays.js";
import { traverseSchema } from "./schemaUtils.js";
import { normalizeDateTimeFieldValue } from "../utils/dateTime.js";
import { joinFieldPath } from "../utils/pathCodec.js";
import { CHOICE_TYPES } from "./fieldTypeSets.js";

export const sanitizeFileUploadEntry = (entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const name = typeof entry.name === "string" ? entry.name : "";
  const driveFileId = typeof entry.driveFileId === "string" ? entry.driveFileId : "";
  const driveFileUrl = typeof entry.driveFileUrl === "string" ? entry.driveFileUrl : "";
  if (!name && !driveFileId && !driveFileUrl) return null;
  return { name, driveFileId, driveFileUrl };
};

export const parseFileUploadStorage = (rawValue) => {
  let source = rawValue;
  if (typeof source === "string") {
    const trimmed = source.trim();
    if (!trimmed) return { files: [], folderUrl: "", folderName: "" };
    try {
      source = JSON.parse(trimmed);
    } catch (_error) {
      return { files: [], folderUrl: "", folderName: "" };
    }
  }
  if (Array.isArray(source)) {
    return {
      files: source.map(sanitizeFileUploadEntry).filter(Boolean),
      folderUrl: "",
      folderName: "",
    };
  }
  if (source && typeof source === "object") {
    const filesSource = ensureArray(source.files);
    const folderUrl = typeof source.folderUrl === "string" ? source.folderUrl.trim() : "";
    // 論理パス（フォルダ名）。プロジェクト移動・コピー後に物理が死んでも再リンクするためのアンカー。
    const folderName = typeof source.folderName === "string" ? source.folderName.trim() : "";
    return {
      files: filesSource.map(sanitizeFileUploadEntry).filter(Boolean),
      folderUrl,
      folderName,
    };
  }
  return { files: [], folderUrl: "", folderName: "" };
};

export const normalizeFileUploadEntries = (rawValue) => parseFileUploadStorage(rawValue).files;

export const buildFileUploadEntry = (result) => ({
  name: typeof result?.fileName === "string" ? result.fileName : "",
  driveFileId: typeof result?.fileId === "string" ? result.fileId : "",
  driveFileUrl: typeof result?.fileUrl === "string" ? result.fileUrl : "",
});

export const serializeFileUploadValue = (value, folderUrl = "", folderName = "") => {
  const files = Array.isArray(value)
    ? value.map((entry) => sanitizeFileUploadEntry(entry)).filter(Boolean)
    : [];
  const trimmedFolderUrl = typeof folderUrl === "string" ? folderUrl.trim() : "";
  const trimmedFolderName = typeof folderName === "string" ? folderName.trim() : "";
  if (files.length === 0 && !trimmedFolderUrl && !trimmedFolderName) return "";
  // 物理(folderUrl)も論理(folderName)も無ければ配列のみ（後方互換）。
  if (!trimmedFolderUrl && !trimmedFolderName) return JSON.stringify(files);
  // 論理パス（folderName）を必ず同梱し、プロジェクト移動・コピー後の再リンクを可能にする。
  const obj = { files };
  if (trimmedFolderUrl) obj.folderUrl = trimmedFolderUrl;
  if (trimmedFolderName) obj.folderName = trimmedFolderName;
  return JSON.stringify(obj);
};

export const collectResponses = (fields, responses, options = {}) => {
  const out = {};
  const orderList = [];
  const fileUploadFolderUrls = options?.fileUploadFolderUrls || {};
  const fileUploadFolderNames = options?.fileUploadFolderNames || {};

  traverseSchema(fields, (field, context) => {
    const value = responses?.[field.id];
    const base = joinFieldPath(context.pathSegments);

    if (field.type === "checkboxes" && Array.isArray(value)) {
      // 元データ方式: 選択ラベルごとに `親/選択肢` 列へマーカー "●" を立てる。
      value.forEach((lbl) => {
        if (typeof lbl !== "string" || !lbl) return;
        const key = joinFieldPath(context.pathSegments.concat(lbl));
        out[key] = "●";
        orderList.push(key);
      });
    } else if (["radio", "select"].includes(field.type) && typeof value === "string" && value) {
      // 元データ方式: 選択値の `親/選択肢` 列へマーカー "●" を立てる。
      const key = joinFieldPath(context.pathSegments.concat(value));
      out[key] = "●";
      orderList.push(key);
    } else if (field.type === "fileUpload") {
      const folderUrl = typeof fileUploadFolderUrls[field.id] === "string"
        ? fileUploadFolderUrls[field.id]
        : "";
      const folderName = typeof fileUploadFolderNames[field.id] === "string"
        ? fileUploadFolderNames[field.id]
        : "";
      const serialized = serializeFileUploadValue(value, folderUrl, folderName);
      if (serialized) {
        out[base] = serialized;
        orderList.push(base);
      }
    } else if (field.type === "substitution") {
      if (value != null && value !== "") {
        out[base] = String(value);
        orderList.push(base);
      }
    } else if (["text", "textarea", "number", "regex", "date", "time", "url", "userName", "email", "phone"].includes(field.type) && value != null && value !== "") {
      // date/time 型は保存時に正規化（時刻 00:00 / 基準日 1899-12-30 を GAS 側で
      // 補完できるよう、フロントは canonical な YYYY-MM-DD / HH:mm:ss に揃える）
      // number 型は Number 化して数値で保存する（AlaSQL の SUM/AVG が文字列を扱えないため）
      let normalized;
      if (field.type === "date" || field.type === "time") {
        normalized = normalizeDateTimeFieldValue(value, field.type, { precision: field.timePrecision });
      } else if (field.type === "number") {
        const n = typeof value === "number" ? value : Number(value);
        normalized = Number.isFinite(n) ? n : null;
      } else {
        normalized = value;
      }
      if (normalized === "" || normalized == null) return;
      out[base] = normalized;
      orderList.push(base);
    }
  }, { responses });

  return out;
};

const DATA_VALUE_TEXT_TYPES = ["text", "textarea", "number", "regex", "date", "time", "url", "userName", "email", "phone"];

const isChoiceMarker = (value) => value === true || value === 1 || value === "1" || value === "●";

// 選択肢フィールドの options ラベルを重複除去して取得する。
export const toChoiceOptionLabels = (field) => {
  const options = Array.isArray(field?.options) ? field.options : [];
  const labels = [];
  const seen = new Set();
  options.forEach((opt) => {
    const label = typeof opt?.label === "string" ? opt.label : "";
    if (!label || seen.has(label)) return;
    labels.push(label);
    seen.add(label);
  });
  return labels;
};

const toRawSelectedLabels = (type, value) => {
  const labels = [];
  const seen = new Set();
  const add = (candidate) => {
    if (typeof candidate !== "string" || !candidate || seen.has(candidate)) return;
    labels.push(candidate);
    seen.add(candidate);
  };

  if (type === "checkboxes") {
    if (Array.isArray(value)) {
      value.forEach((item) => add(item));
      return labels;
    }
    if (typeof value === "string") {
      add(value);
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([label, marker]) => {
        if (isChoiceMarker(marker)) add(label);
      });
    }
    return labels;
  }

  if (type === "radio" || type === "select") {
    if (typeof value === "string") {
      add(value);
    } else if (Array.isArray(value)) {
      value.forEach((item) => add(item));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([label, marker]) => {
        if (isChoiceMarker(marker)) add(label);
      });
    }
    return labels;
  }

  return labels;
};

// 選択肢フィールドの選択ラベルを options 順（＋未知ラベルは末尾）に正規化する。
// 外部アクション/印刷 items（表示文字列）と template view 値（dataValueMap）で共有する正準実装。
export const toSelectedChoiceLabels = (field, value) => {
  const type = field?.type;
  if (!CHOICE_TYPES.has(type)) return [];

  const rawSelected = toRawSelectedLabels(type, value);
  if (rawSelected.length === 0) return [];

  const selectedSet = new Set(rawSelected);
  const ordered = [];
  const seen = new Set();

  toChoiceOptionLabels(field).forEach((label) => {
    if (!selectedSet.has(label) || seen.has(label)) return;
    ordered.push(label);
    seen.add(label);
  });

  rawSelected.forEach((label) => {
    if (seen.has(label)) return;
    ordered.push(label);
    seen.add(label);
  });

  return type === "checkboxes" ? ordered : ordered.slice(0, 1);
};

/**
 * テンプレート / substitution 式評価用の **統一 typed view マップ** `{ フルパス: 値 }` を構築する。
 * `{{...}}`（ビュー形式）トークンの行ソースに使う。元データ形式（選択肢ごとの真偽値展開）は廃止。
 *
 * - 選択肢（checkboxes）は選択ラベルを共有 codec でエスケープ付きカンマ連結した
 *   **フィールド 1 列**（radio/select は単一ラベル）。
 * - text/number/date 等は `collectResponses` と同じ typed 正規化値（number は数値型・日付は canonical）。
 *   これにより `{{`金額` + 50}}` のような算術が文字列連結にならず正しく動く。
 * - substitution は計算済み文字列（あれば）。fileUpload は行構築時に FILE_* UDF 用
 *   配列で上書きされるためここでは出力しない。
 */
export const buildDataValueMap = (fields, responses) => {
  const out = {};
  traverseSchema(fields, (field, context) => {
    const base = joinFieldPath(context.pathSegments);
    const value = responses?.[field.id];

    if (CHOICE_TYPES.has(field.type)) {
      // テンプレ行は表示用途なので複数選択は表示区切り ", "（エスケープなし）で連結する。
      // ※ 保存・検索の正準区切り（codec のエスケープ付き ","）とは別経路。
      const labels = toSelectedChoiceLabels(field, value);
      if (field.type === "checkboxes") {
        if (labels.length > 0) out[base] = labels.join(", ");
      } else if (labels[0]) {
        out[base] = labels[0];
      }
    } else if (field.type === "fileUpload") {
      // FILE_* UDF 用配列が行構築時に同じ path へ入るため、ここでは出力しない。
    } else if (field.type === "substitution") {
      if (value != null && value !== "") out[base] = String(value);
    } else if (DATA_VALUE_TEXT_TYPES.includes(field.type) && value != null && value !== "") {
      let normalized;
      if (field.type === "date" || field.type === "time") {
        normalized = normalizeDateTimeFieldValue(value, field.type, { precision: field.timePrecision });
      } else if (field.type === "number") {
        const n = typeof value === "number" ? value : Number(value);
        normalized = Number.isFinite(n) ? n : null;
      } else {
        normalized = value;
      }
      if (normalized === "" || normalized == null) return;
      out[base] = normalized;
    }
  }, { responses });

  return out;
};

export const collectAllPossiblePaths = (fields) => {
  const paths = [];

  traverseSchema(fields, (field, context) => {
    const base = joinFieldPath(context.pathSegments);

    if (CHOICE_TYPES.has(field.type) && Array.isArray(field.options)) {
      // 元データ方式: 選択肢はオプションごとに `親/選択肢` 列を列挙する。
      field.options.forEach((option) => {
        const optionLabel = option?.label || "";
        paths.push(joinFieldPath(context.pathSegments.concat(optionLabel)));
      });
    } else if (field.type === "fileUpload") {
      paths.push(base);
    } else if (field.type === "substitution") {
      paths.push(base);
    } else if (["text", "textarea", "number", "regex", "date", "time", "url", "userName", "email", "phone"].includes(field.type)) {
      paths.push(base);
    }
  });

  return paths;
};

export const resolveFileDisplayName = (fileName, hideExtension) => {
  if (!fileName) return "ファイル";
  if (!hideExtension) return fileName;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
};

export const sortResponses = (responses, schema = null) => {
  const source = responses || {};

  if (schema) {
    const allPaths = collectAllPossiblePaths(schema);
    const sorted = {};
    allPaths.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        sorted[key] = source[key];
      }
    });
    return { map: sorted, keys: allPaths };
  }

  const keys = Object.keys(source).sort((a, b) => String(a).localeCompare(String(b), "ja"));
  const sorted = {};
  keys.forEach((key) => {
    sorted[key] = source[key];
  });
  return { map: sorted, keys };
};
