import { ensureArray } from "../../utils/arrays.js";
import { extractJstPartsFull, formatUnixMsDateTimeSec, toUnixMs, pad2 } from "../../utils/dateTime.js";
import { resolveFileDisplayName, buildDataValueMap, toChoiceOptionLabels, toSelectedChoiceLabels } from "../../core/collect.js";
import { findFirstFileUploadField } from "../../core/schema.js";
import { shouldShowUnconditionalChildren } from "../../core/fieldValue.js";
import { CHOICE_TYPES } from "../../utils/responses.js";
import { traverseSchema } from "../../core/schemaUtils.js";
import { isExcludedSearchOrPrintField } from "../search/searchTable.js";
import { isPlainObject } from "../../utils/objectShape.js";
import { joinFieldPath, escapeSegment, PATH_SEP } from "../../utils/pathCodec.js";

// 選択肢ラベルの正準実装は core/collect.js に統一（外部アクション/印刷 items と template view 値で共有）。
// 既存 import 元（FieldRenderer 等）との互換のため re-export する。
export { toChoiceOptionLabels, toSelectedChoiceLabels };

export const hasVisibleValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
};

export const isTextareaField = (field) => field?.type === "textarea" || (field?.type === "text" && field?.multiline);

// 印刷ファイル名は JST 壁時計 (`YYYYMMDD_HHmmss`) で揃える。本プロジェクトは
// JST 業務利用前提で、ファイル名タイムスタンプは常に日本時間表示にする必要がある。
// `Date.prototype.get*` は実行環境 TZ 依存で UTC 環境では別時刻になってしまうので、
// extractJstPartsFull を経由して TZ 非依存に成分を取り出す。
export const formatFileTimestamp = (date) => {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const p = extractJstPartsFull(safeDate);
  if (!p) return "";
  return `${p.year}${pad2(p.month)}${pad2(p.day)}_${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
};

export const sanitizePrintFileNamePart = (input, fallback = "record") => {
  const normalized = String(input ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");
  return normalized || fallback;
};

export const formatPrintItemValue = (field, value) => {
  if (field?.type === "message") return "";
  if (field?.type === "printTemplate") return "";
  if (field?.type === "externalAction") return "";
  if (field?.type === "substitution") {
    return value != null && value !== "" ? String(value) : "";
  }
  if (field?.type === "fileUpload") {
    const files = ensureArray(value);
    return files.map((f) => resolveFileDisplayName(f?.name || "不明なファイル", field?.hideFileExtension)).join(", ");
  }
  if (CHOICE_TYPES.has(field?.type)) {
    return toSelectedChoiceLabels(field, value).join(", ");
  }
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const resolveOmitEmptyRowsOnPrint = (settings = {}, overrideValue = undefined) => {
  if (overrideValue !== undefined) return !!overrideValue;
  return settings?.omitEmptyRowsOnPrint !== false;
};

export const resolveShowPrintHeader = (settings = {}, overrideValue = undefined) => {
  if (overrideValue !== undefined) return !!overrideValue;
  return settings?.showPrintHeader !== false;
};

// デフォルト様式（テンプレート未選択時の自動生成 Doc）で、アップロードファイル名に
// Drive リンクを貼るか。未設定は ON（true）。テンプレート出力には影響しない。
export const resolveLinkUploadFilesOnPrint = (settings = {}, overrideValue = undefined) => {
  if (overrideValue !== undefined) return !!overrideValue;
  return settings?.linkUploadFilesOnPrint !== false;
};

export const formatRecordMetaDateTime = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" && value.trim() === "") return "";

  const unixMs = toUnixMs(value);
  if (Number.isFinite(unixMs) && unixMs > 0) {
    return formatUnixMsDateTimeSec(unixMs);
  }

  if (typeof value === "string") return value.trim();
  return "";
};

const isExcludedPrintField = (field) => (
  field?.type === "printTemplate"
  || field?.type === "externalAction"
  || ((field?.type === "message") && field?.excludeFromSearchAndPrint === true)
  || (field?.type === "substitution" && field?.excludeFromSearch === true)
);

// 子レコードの識別マーカー（外部アクション の question セグメント / 印刷のマーカー行ラベルに使う）。
// record.no（子フォーム内で一意）優先、空なら 1 始まりのインデックス。"#" 接頭辞で実フィールド
// ラベルと衝突しないようにする。
const resolveChildRecordMarker = (record, index) => {
  const no = record && record.no != null ? String(record.no).trim() : "";
  return `#${no || (index + 1)}`;
};

// レコードの質問内容と入力情報を { question, value, type }[] に整形する。
// question は「ヘッダー階層を "/" で連結した文字列」で、検索一覧のヘッダー
// (= traverseSchema の pathSegments) と同じ表現に統一する。外部アクション 送信や
// 外部アクションの payload (record.items) で共有する。
//
// childDataByFieldId（{ fieldId: 子フォーム合成オブジェクト }）を渡すと、formLink 項目を
// 他の質問カードと同じ items 列へ展開する。question は「親カードパス / #レコードNo / 子質問パス」で、
// 通常のネスト質問と同じ "/" 連結（マーカーのみ escapeSegment、既連結のカードパス/子質問は verbatim）。
export const buildRecordItems = (schema, responses, { childDataByFieldId } = {}) => {
  const items = [];
  traverseSchema(schema || [], (field, context) => {
    if (isExcludedSearchOrPrintField(field)) return;
    if (field?.type === "formLink") {
      const childObj = childDataByFieldId && field?.id ? childDataByFieldId[field.id] : undefined;
      const records = ensureArray(childObj?.records);
      if (records.length === 0) return; // 子データ無しは空の placeholder 行を出さず skip。
      const cardPathJoined = joinFieldPath(context.pathSegments || []);
      records.forEach((record, ri) => {
        const markerSeg = escapeSegment(resolveChildRecordMarker(record, ri), PATH_SEP);
        const childItems = ensureArray(record?.items);
        childItems.forEach((childItem) => {
          items.push({
            question: cardPathJoined + PATH_SEP + markerSeg + PATH_SEP + childItem.question,
            value: childItem.value,
            type: childItem.type || "text",
          });
        });
      });
      return;
    }
    items.push({
      question: joinFieldPath(context.pathSegments || []),
      value: formatPrintItemValue(field, (responses || {})[field?.id]),
      type: field?.type || "text",
    });
  }, { responses: responses || {} });
  return items;
};

const resolveFieldId = (field, depth, index) => field?.id || `tmp_${depth}_${index}_${field?.label || ""}`;

const resolveFieldLabel = (field) => {
  const fallback = field?.type === "message" ? "メッセージ" : "項目";
  return typeof field?.label === "string" && field.label.trim() ? field.label.trim() : fallback;
};

const isAlwaysIncludedPrintType = (type) => type === "message" || type === "fileUpload";

const shouldIncludePrintItem = (item, omitEmptyRows) => {
  if (!omitEmptyRows) return true;
  if (isAlwaysIncludedPrintType(item?.type)) return true;
  return hasVisibleValue(item?.value);
};

const appendPrintItems = (fields, responses, depth, items, options = {}) => {
  (fields || []).forEach((field, index) => {
    const fieldId = resolveFieldId(field, depth, index);
    const normalizedField = { ...field, id: fieldId };
    if (isExcludedPrintField(normalizedField)) return;

    if (normalizedField?.type === "formLink") {
      // 子フォームデータを印刷様式の項目表へ展開する。子データは実 field.id でキー付け。
      const childObj = options.childDataByFieldId && field?.id ? options.childDataByFieldId[field.id] : undefined;
      const records = ensureArray(childObj?.records);
      if (records.length === 0) return; // 子データ無しは行を出さず skip。
      const total = Number.isFinite(childObj.count) ? childObj.count : records.length;
      const countText = childObj.truncated ? `${total}件（先頭${records.length}件を表示）` : `${total}件`;
      // カードヘッダ・レコードマーカー行は omitEmptyRows でも常時表示（子データの存在を示すため）。
      items.push({ label: resolveFieldLabel(normalizedField), value: countText, depth, type: "formLink" });
      records.forEach((record, ri) => {
        items.push({ label: resolveChildRecordMarker(record, ri), value: "", depth: depth + 1, type: "formLinkRecord" });
        const childItems = ensureArray(record?.items);
        childItems.forEach((childItem) => {
          const childRow = {
            label: childItem.question,
            value: childItem.value,
            depth: depth + 2,
            type: childItem.type || "text",
          };
          if (shouldIncludePrintItem(childRow, options.omitEmptyRows)) items.push(childRow);
        });
      });
      return;
    }

    const value = (responses || {})[fieldId] ?? (responses || {})[field?.id];

    const nextItem = {
      label: resolveFieldLabel(normalizedField),
      value: formatPrintItemValue(normalizedField, value),
      depth,
      type: normalizedField?.type || "text",
    };
    // fileUpload はファイル名（value）に加え、Drive リンク用に { name, url } を添える。
    // GAS のデフォルト様式が linkUploadFiles ON のときファイル名へリンクを貼る。
    // files が無い（添付なし）場合はプロパティを足さない（既存 items 比較を壊さないため）。
    if (normalizedField?.type === "fileUpload") {
      const fileEntries = ensureArray(value).map((f) => ({
        name: resolveFileDisplayName(f?.name || "不明なファイル", normalizedField?.hideFileExtension),
        url: typeof f?.driveFileUrl === "string" ? f.driveFileUrl : "",
      }));
      if (fileEntries.length > 0) nextItem.files = fileEntries;
    }
    if (shouldIncludePrintItem(nextItem, options.omitEmptyRows)) {
      items.push(nextItem);
    }

    if (normalizedField?.childrenByValue) {
      const selectedLabels = toSelectedChoiceLabels(normalizedField, value);
      if (normalizedField.type === "checkboxes") {
        selectedLabels.forEach((label) => {
          appendPrintItems(normalizedField.childrenByValue?.[label] || [], responses, depth + 1, items, options);
        });
      } else if (normalizedField.type === "radio" || normalizedField.type === "select") {
        const selected = selectedLabels[0];
        if (selected) {
          appendPrintItems(normalizedField.childrenByValue?.[selected] || [], responses, depth + 1, items, options);
        }
      }
    }

    if (Array.isArray(normalizedField?.children) && normalizedField.children.length > 0) {
      if (shouldShowUnconditionalChildren(normalizedField, value)) {
        appendPrintItems(normalizedField.children, responses, depth + 1, items, options);
      }
    }
  });
  return items;
};

export const buildFieldPathsMap = (fields, prefix = "", map = {}) => {
  (fields || []).forEach((field) => {
    const label = typeof field?.label === "string" ? field.label.trim() : "";
    const path = label ? (prefix ? `${prefix}|${label}` : label) : prefix;
    if (field?.id && label) {
      map[field.id] = path;
    }
    if (isPlainObject(field?.childrenByValue)) {
      // 選択肢分岐の子は、選択肢ラベルもパスに含める（traverseSchema / buildDataValueMap と一致）。
      // 例: 選択1|答1|答1補足。これを省くと {...} と {{...}} でパスが食い違い、同名子の衝突も起きる。
      Object.entries(field.childrenByValue).forEach(([optionLabel, children]) => {
        const branchPath = path ? `${path}|${optionLabel}` : optionLabel;
        buildFieldPathsMap(children, branchPath, map);
      });
    }
    if (Array.isArray(field?.children)) {
      buildFieldPathsMap(field.children, path, map);
    }
  });
  return map;
};

export const collectFileUploadMeta = (fields, options = {}) => {
  const meta = {};
  const responses = options?.responses;
  const folderUrlsByField = options?.folderUrlsByField || {};
  const folderNamesByField = options?.folderNamesByField || {};

  // 全ノードを訪問して fileUpload 項目だけ拾う（パス不要なので共有 traverseSchema を使う）。
  traverseSchema(fields, (field) => {
    if (field?.type === "fileUpload" && field?.id) {
      const entry = {};
      if (field.hideFileExtension) entry.hideFileExtension = true;
      if (responses) {
        const value = responses[field.id];
        const files = ensureArray(value);
        entry.fileNames = files
          .map((f) => resolveFileDisplayName(f?.name || "", field?.hideFileExtension))
          .filter(Boolean);
        entry.fileUrls = files.map((f) => f?.driveFileUrl || "").filter(Boolean);
        // 生ファイル名（拡張子込み）。GAS 側で folderName と組んで論理解決し、コピー/移動後に
        // URL が空でも 06_upload_files 配下の複製から URL を復元するために使う。
        entry.rawFileNames = files.map((f) => f?.name || "").filter(Boolean);
      }
      const folderUrl = folderUrlsByField[field.id];
      if (typeof folderUrl === "string" && folderUrl) entry.folderUrl = folderUrl;
      const folderName = folderNamesByField[field.id];
      if (typeof folderName === "string" && folderName) entry.folderName = folderName;
      if (Object.keys(entry).length > 0) meta[field.id] = entry;
    }
  });
  return meta;
};

// formLink 項目について、プリロード済みの子フォーム合成オブジェクトを { fieldId: childObj } に
// 整形する。childDataByFieldId（PreviewPage の childFormMeta）から schema 上に実在する formLink
// フィールドの分だけ拾う（GAS の row 注入で path へ展開し CHILD_FORM_* UDF が参照する）。
export const collectChildFormMeta = (fields, childDataByFieldId = {}) => {
  const meta = {};
  const source = childDataByFieldId && typeof childDataByFieldId === "object" ? childDataByFieldId : {};
  // 全ノードを訪問して formLink 項目だけ拾う（共有 traverseSchema を使う）。
  traverseSchema(fields, (field) => {
    if (field?.type === "formLink" && field?.id) {
      const obj = source[field.id];
      if (obj && typeof obj === "object") meta[field.id] = obj;
    }
  });
  return meta;
};

const assignFieldValues = (fields, responses, map, isActive = true, depth = 0) => {
  (fields || []).forEach((field, index) => {
    const fieldId = resolveFieldId(field, depth, index);
    const normalizedField = { ...field, id: fieldId };
    const rawValue = isActive ? ((responses || {})[fieldId] ?? (responses || {})[field?.id]) : "";
    map[fieldId] = isActive ? formatPrintItemValue(normalizedField, rawValue) : "";

    if (normalizedField?.childrenByValue) {
      const selectedLabels = isActive ? toSelectedChoiceLabels(normalizedField, rawValue) : [];
      const selectedSet = new Set(selectedLabels);
      Object.entries(normalizedField.childrenByValue).forEach(([optionLabel, children]) => {
        assignFieldValues(children, responses, map, isActive && selectedSet.has(optionLabel), depth + 1);
      });
    }

    if (Array.isArray(normalizedField?.children) && normalizedField.children.length > 0) {
      const childActive = isActive && shouldShowUnconditionalChildren(normalizedField, rawValue);
      assignFieldValues(normalizedField.children, responses, map, childActive, depth + 1);
    }
  });
  return map;
};

export const buildFieldValuesMap = (fields, responses, map = {}) => assignFieldValues(fields, responses, map);

const resolveDriveFolderUrl = (driveFolderState) => {
  if (!driveFolderState || typeof driveFolderState !== "object") return "";
  const inputUrl = typeof driveFolderState.inputUrl === "string" ? driveFolderState.inputUrl.trim() : "";
  const resolvedUrl = typeof driveFolderState.resolvedUrl === "string" ? driveFolderState.resolvedUrl.trim() : "";
  return inputUrl || resolvedUrl;
};

export const buildPrintDocumentPayload = ({
  schema,
  responses,
  settings = {},
  recordId,
  exportedAt = new Date(),
  omitEmptyRows,
  showHeader,
  linkUploadFiles,
  driveFolderState = null,
  useTemporaryFolder = false,
  folderUrlsByField = {},
  childDataByFieldId = {},
}) => {
  const safeExportedAt = exportedAt instanceof Date && !Number.isNaN(exportedAt.getTime()) ? exportedAt : new Date();
  const formTitle = typeof settings.formTitle === "string" && settings.formTitle.trim() ? settings.formTitle.trim() : "受付フォーム";
  const resolvedRecordId = String(recordId || settings.recordId || "").trim() || "record";
  const recordNo = settings.recordNo === undefined || settings.recordNo === null ? "" : String(settings.recordNo).trim();
  const modifiedAt = formatRecordMetaDateTime(settings.modifiedAtUnixMs ?? settings.modifiedAt);
  const recordRef = recordNo || resolvedRecordId;
  const shouldOmitEmptyRows = resolveOmitEmptyRowsOnPrint(settings, omitEmptyRows);
  const shouldShowHeader = resolveShowPrintHeader(settings, showHeader);
  const shouldLinkUploadFiles = resolveLinkUploadFilesOnPrint(settings, linkUploadFiles);
  const folderUrl = resolveDriveFolderUrl(driveFolderState);

  const firstUploadField = findFirstFileUploadField(schema);
  const fieldRootFolderUrl = firstUploadField?.driveRootFolderUrl || "";
  const fieldFolderNameTemplate = firstUploadField?.driveFolderNameTemplate || "";

  const childFormMeta = collectChildFormMeta(schema, childDataByFieldId);
  const hasChildFormMeta = Object.keys(childFormMeta).length > 0;

  const hasDriveSettings = fieldRootFolderUrl || fieldFolderNameTemplate || folderUrl || useTemporaryFolder || hasChildFormMeta;
  const driveSettings = hasDriveSettings ? {
    rootFolderUrl: fieldRootFolderUrl,
    folderNameTemplate: fieldFolderNameTemplate,
    formId: settings.formId || "",
    recordId: resolvedRecordId,
    folderUrl,
    useTemporaryFolder: !!useTemporaryFolder,
    responses: responses || {},
    fieldPaths: buildFieldPathsMap(schema),
    fieldValues: buildFieldValuesMap(schema, responses),
    dataValues: buildDataValueMap(schema, responses),
    fileUploadMeta: collectFileUploadMeta(schema, {
      responses: responses || {},
      folderUrlsByField,
    }),
    ...(hasChildFormMeta ? { childFormMeta } : {}),
  } : undefined;

  return {
    fileName: `印刷様式_${sanitizePrintFileNamePart(formTitle, "form")}_${sanitizePrintFileNamePart(recordRef, "record")}_${formatFileTimestamp(safeExportedAt)}`,
    formTitle,
    formId: settings.formId || "",
    templateSourceUrl: settings.standardPrintTemplateUrl || "",
    recordId: resolvedRecordId,
    recordNo,
    modifiedAt,
    showHeader: shouldShowHeader,
    linkUploadFiles: shouldLinkUploadFiles,
    exportedAtIso: safeExportedAt.toISOString(),
    items: appendPrintItems(schema, responses, 0, [], { omitEmptyRows: shouldOmitEmptyRows, childDataByFieldId }),
    ...(driveSettings ? { driveSettings } : {}),
  };
};
