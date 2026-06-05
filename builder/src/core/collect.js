import { traverseSchema } from "./schemaUtils.js";
import { normalizeDateTimeFieldValue } from "../utils/dateTime.js";
import { joinFieldPath } from "../utils/pathCodec.js";

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
    if (!trimmed) return { files: [], folderUrl: "" };
    try {
      source = JSON.parse(trimmed);
    } catch (_error) {
      return { files: [], folderUrl: "" };
    }
  }
  if (Array.isArray(source)) {
    return {
      files: source.map(sanitizeFileUploadEntry).filter(Boolean),
      folderUrl: "",
    };
  }
  if (source && typeof source === "object") {
    const filesSource = Array.isArray(source.files) ? source.files : [];
    const folderUrl = typeof source.folderUrl === "string" ? source.folderUrl.trim() : "";
    return {
      files: filesSource.map(sanitizeFileUploadEntry).filter(Boolean),
      folderUrl,
    };
  }
  return { files: [], folderUrl: "" };
};

export const normalizeFileUploadEntries = (rawValue) => parseFileUploadStorage(rawValue).files;

export const buildFileUploadEntry = (result) => ({
  name: typeof result?.fileName === "string" ? result.fileName : "",
  driveFileId: typeof result?.fileId === "string" ? result.fileId : "",
  driveFileUrl: typeof result?.fileUrl === "string" ? result.fileUrl : "",
});

const serializeFileUploadValue = (value, folderUrl = "") => {
  const files = Array.isArray(value)
    ? value.map((entry) => sanitizeFileUploadEntry(entry)).filter(Boolean)
    : [];
  const trimmedFolderUrl = typeof folderUrl === "string" ? folderUrl.trim() : "";
  if (files.length === 0 && !trimmedFolderUrl) return "";
  if (!trimmedFolderUrl) return JSON.stringify(files);
  return JSON.stringify({ files, folderUrl: trimmedFolderUrl });
};

export const collectResponses = (fields, responses, options = {}) => {
  const out = {};
  const orderList = [];
  const fileUploadFolderUrls = options?.fileUploadFolderUrls || {};

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
      const serialized = serializeFileUploadValue(value, folderUrl);
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

const DATA_CHOICE_TYPES = ["checkboxes", "radio", "select"];
const DATA_VALUE_TEXT_TYPES = ["text", "textarea", "number", "regex", "date", "time", "url", "userName", "email", "phone"];

const collectSelectedOptionLabels = (type, value) => {
  if (type === "checkboxes") return Array.isArray(value) ? value.filter((v) => typeof v === "string" && v) : [];
  return typeof value === "string" && value ? [value] : [];
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

    if (DATA_CHOICE_TYPES.includes(field.type)) {
      // テンプレ行は表示用途なので複数選択は表示区切り ", "（エスケープなし）で連結する。
      // ※ 保存・検索の正準区切り（codec のエスケープ付き ","）とは別経路。
      const labels = collectSelectedOptionLabels(field.type, value);
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

    if (["checkboxes", "radio", "select"].includes(field.type) && Array.isArray(field.options)) {
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
