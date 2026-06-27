import {
  formatUnixMsDate,
  formatCanonical,
  toUnixMs,
} from "../../utils/dateTime.js";
import { isChoiceMarkerValue } from "../../utils/responses.js";
import { CHOICE_TYPES } from "../../core/fieldTypeSets.js";
import { normalizeFileUploadEntries } from "../../core/collect.js";
import { splitMultiValue as splitMultiValueShared } from "../../utils/multiValue.js";
import { joinFieldPath, splitFieldKey, PATH_SEP } from "../../utils/pathCodec.js";

const FALSE_LIKE_VALUES = new Set([null, undefined, "", false, 0, "0"]);

// 「セル値が空欄」を表す共通判定。null / undefined / "" を空欄として扱う。
// 簡易検索の display 比較・compareValue の normalizeValue・空セル分岐で使用。
// 注: alasql 行（buildSearchRow）では "" も null に統一しているため、
// IS NULL 判定はこの関数を使わず生 SQL に任せる。
export const isEmptyCell = (value) => value === undefined || value === null || value === "";

export const toBooleanLike = (value) => {
  if (Array.isArray(value)) {
    return value.some((item) => toBooleanLike(item));
  }
  return !FALSE_LIKE_VALUES.has(value);
};

export const columnType = (column) => column?.sourceType || column?.type || "";
export const isChoiceColumn = (column) => CHOICE_TYPES.has(columnType(column));
export const isBooleanSortColumn = (column) => columnType(column) === "checkboxes";
export const isNumericColumn = (column) => {
  const type = columnType(column);
  return type === "number";
};
export const isDateLikeColumn = (column) => {
  const type = columnType(column);
  return type === "date" || type === "time" || column?.key === "modifiedAt" || column?.key === "createdAt";
};
export const toNumericValue = (value) => {
  if (isEmptyCell(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const valueToDisplayString = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => valueToDisplayString(item))
      .filter((item) => !isEmptyCell(item))
      .join(",");
  }
  if (isEmptyCell(value)) return "";
  return String(value);
};

// 時刻精度 → formatCanonical の kind。minute→分まで / second→秒まで / millisecond→ミリ秒まで。
// 既定（未設定）は "second"（フォーム既定精度に一致）。
export const timeKindForPrecision = (precision) => {
  if (precision === "minute") return "timem";
  if (precision === "millisecond") return "time";
  return "times";
};

export const formatTemporalValue = (rawValue, unixMs, column) => {
  const type = columnType(column);
  if (type !== "date" && type !== "time") return valueToDisplayString(rawValue);

  if (type === "time") {
    const canonical = formatCanonical(rawValue, timeKindForPrecision(column?.timePrecision));
    if (canonical) return canonical;
    return valueToDisplayString(rawValue);
  }

  const ms = Number.isFinite(unixMs) ? unixMs : toUnixMs(rawValue);
  if (!Number.isFinite(ms)) return valueToDisplayString(rawValue);
  return formatUnixMsDate(ms);
};

export const deriveChoiceLabels = (key, value) => {
  if (!isChoiceMarkerValue(value)) return null;
  if (typeof key !== "string") return null;

  // マーカー列キー（`親/選択肢`）はセグメント 2 つ以上。"/" は "\/" エスケープ対応で分割する。
  const segments = splitFieldKey(key).filter(Boolean);
  if (segments.length < 2) return null;

  const optionLabel = segments[segments.length - 1];

  return {
    optionLabel,
  };
};

export const normalizeSearchText = (text) => String(text || "").toLowerCase();
export const normalizeColumnName = (text) => String(text || "").trim().toLowerCase();
export const isEntryIdColumnName = (columnName) => normalizeColumnName(columnName) === "id";

// 複数値セル ("カラス,キタツネ" / エスケープ付き "赤\, 青,カラス") を集合として扱うための分割ヘルパ。
// 共有 codec（multiValue.js）に委譲し、保存・再読込・分析 view 行・MV_EQ/MV_IN UDF と
// 完全に同じエスケープ規則（区切り `,`、ラベル内の `,`/`\` はバックスラッシュエスケープ）で分割する。
export const splitMultiValue = splitMultiValueShared;

// candidates 配列の各要素を splitMultiValue で平坦化して token 配列を返す。
// COMPARE / COLUMN_IN の列未解決フォールバックで使用するヘルパ。
export const collectMultiValueTokens = (candidates) => {
  const tokens = [];
  (candidates || []).forEach((candidate) => {
    splitMultiValue(candidate).forEach((token) => tokens.push(token));
  });
  return tokens;
};

export const buildSearchableCandidates = (key, value, unixMs = undefined) => {
  const candidates = [];

  const fileEntries = normalizeFileUploadEntries(value);
  if (fileEntries.length > 0) {
    fileEntries.forEach((entry) => {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (name) candidates.push(name);
    });
    return candidates;
  }

  const displayValue = valueToDisplayString(value, unixMs);
  if (displayValue) {
    candidates.push(displayValue);
  }

  const choiceLabels = deriveChoiceLabels(key, value);
  if (choiceLabels?.optionLabel) {
    candidates.push(choiceLabels.optionLabel);
  }

  return candidates;
};

export const resolveChoiceDisplayValue = (path, rawValue, column) => {
  const type = columnType(column);
  if (type !== "radio" && type !== "select") return rawValue;
  if (!isChoiceMarkerValue(rawValue)) return rawValue;
  const choiceLabels = deriveChoiceLabels(path, rawValue);
  if (!choiceLabels?.optionLabel) return rawValue;
  return choiceLabels.optionLabel;
};

export const compareStrings = (a, b) => {
  const aa = String(a || "");
  const bb = String(b || "");
  return aa.localeCompare(bb, "ja");
};

export const compareValues = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'number' && typeof b !== 'number') {
    return -1;
  }
  if (typeof a !== 'number' && typeof b === 'number') {
    return 1;
  }
  return compareStrings(a, b);
};

export const collectDirectOptionLabels = (data, path, optionOrder = null) => {
  const optionValues = [];
  const prefix = `${path}${PATH_SEP}`;
  Object.entries(data).forEach(([key, value]) => {
    if (!key.startsWith(prefix) || key === path) return;
    // remainder はエスケープ済みの 1 セグメント（直下の選択肢）のときのみ採用。
    const remSegs = splitFieldKey(key.slice(prefix.length));
    if (remSegs.length !== 1 || remSegs[0] === "") return;
    if (toBooleanLike(value)) {
      optionValues.push(remSegs[0]);
    }
  });
  if (Array.isArray(optionOrder) && optionOrder.length > 0) {
    const orderMap = new Map(optionOrder.map((label, index) => [label, index]));
    optionValues.sort((a, b) => {
      const orderA = orderMap.has(a) ? orderMap.get(a) : Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.has(b) ? orderMap.get(b) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return compareStrings(a, b);
    });
  }
  return optionValues;
};

// 簡易検索の entry.data フォールバック用に「論理フィールド」を構築する。
// 選択肢マーカー（"親|オプション": ●）は親フィールドへ集約し、選択中オプションを「、」で
// 結合した値だけを検索対象にする（● 値や個別オプションキー自体は対象にしない）。
// 非マーカーキーはそのまま 1 フィールドとして返す。
// SQL モード（alasql / buildSearchRow）は通らないため簡易モード専用。
export const buildEntryLogicalFields = (entry) => {
  const data = entry?.data || {};
  const dataUnixMs = entry?.dataUnixMs || {};
  const keys = Object.keys(data);

  const choiceParentOf = (key) => {
    if (!isChoiceMarkerValue(data[key])) return null;
    const segs = splitFieldKey(key);
    if (segs.length < 2) return null;
    return joinFieldPath(segs.slice(0, -1));
  };

  // 集約対象の親パス集合（裸の親マーカー/重複値を除外するため先に収集）。
  const choiceParents = new Set();
  keys.forEach((key) => {
    const parent = choiceParentOf(key);
    if (parent) choiceParents.add(parent);
  });

  const fields = [];
  const emittedChoice = new Set();
  keys.forEach((key) => {
    const parent = choiceParentOf(key);
    if (parent) {
      if (emittedChoice.has(parent)) return;
      emittedChoice.add(parent);
      fields.push({
        key: parent,
        value: collectDirectOptionLabels(data, parent).join(","),
        unixMs: undefined,
      });
      return;
    }
    // 集約済み親の裸キー（"店舗": ● 等）は ● 自体を対象にしないため除外。
    if (choiceParents.has(key)) return;
    fields.push({ key, value: data[key], unixMs: dataUnixMs[key] });
  });

  return fields;
};

const deriveBooleanValue = (rawValues) => toBooleanLike(rawValues.length ? rawValues : undefined);

const resolveSortValue = ({ rawValues, display, dataUnixMs, path, column }) => {
  // radio/select はラベル文字列で並び替えるため、真偽値ソートは checkboxes のみに限定する
  if (isBooleanSortColumn(column)) {
    return deriveBooleanValue(rawValues) ? 1 : 0;
  }

  if (rawValues.length === 0) return "";
  if (rawValues.length > 1) return display;

  const raw = rawValues[0];

  if (isNumericColumn(column)) {
    const num = toNumericValue(raw);
    if (num !== null) return num;
  }

  return display;
};

export const collectFieldValue = (entry, path, column) => {
  const data = entry?.data || {};
  const dataUnixMs = entry?.dataUnixMs || {};

  const values = [];
  const rawValues = [];
  const addValue = (raw, unixMs) => {
    const normalizedRaw = resolveChoiceDisplayValue(path, raw, column);
    const display = formatTemporalValue(normalizedRaw, unixMs, column);
    if (isEmptyCell(display)) return;
    values.push(display);
    rawValues.push(raw);
  };

  // 直接値がある場合はそれを優先
  const hasDirectValue = Object.prototype.hasOwnProperty.call(data, path);
  const optionValues = collectDirectOptionLabels(data, path, column?.optionOrder);

  if (hasDirectValue) {
    const directValue = data[path];
    const shouldPreferOptionLabels =
      (columnType(column) === "radio" || columnType(column) === "select") &&
      isChoiceMarkerValue(directValue) &&
      optionValues.length > 0;
    if (shouldPreferOptionLabels) {
      optionValues.forEach((v) => addValue(v));
    } else {
      addValue(directValue, dataUnixMs[path]);
    }
  } else {
    // 直接値がない場合のみ、option値を探す
    if (optionValues.length) {
      optionValues.forEach((v) => addValue(v));
    }
  }

  // 空欄ケースは sort 側で null と "" を区別して保持する（ソート時の並び順安定化用）：
  //   1) entry.data に path 自体が無い かつ optionValues も無い → null
  //   2) entry.data に path はあるが値が "" / null / undefined  → ""
  // ※ alasql 行（buildSearchRow）では両者とも null に統一して
  //    `列名 IS NULL` で両方ヒットさせる。簡易検索は cell.display 基準で
  //    両者を「空欄」として扱うので影響なし。
  if (values.length === 0) {
    const isFieldAbsent = !hasDirectValue && optionValues.length === 0;
    return {
      display: "",
      search: "",
      sort: isFieldAbsent ? null : "",
      boolean: deriveBooleanValue(rawValues),
    };
  }

  const display = values.join(",");
  const primary = values[0] || "";
  const sortDisplay = isChoiceColumn(column) && values.length <= 1 ? primary : display;
  const sortValue = resolveSortValue({ rawValues, display: sortDisplay, dataUnixMs, path, column });

  return {
    display,
    search: normalizeSearchText(values.join(" ")),
    sort: sortValue,
    boolean: deriveBooleanValue(rawValues),
  };
};

export const matchColumnName = (column, normalized) => {
  if (!column || !normalized) return false;

  if (column.key && column.key.toLowerCase() === normalized) return true;
  if (column.path && column.path.toLowerCase() === normalized) return true;

  if (Array.isArray(column.searchAliases)) {
    if (column.searchAliases.some((alias) => String(alias || "").toLowerCase() === normalized)) {
      return true;
    }
  }

  if (column.segments && Array.isArray(column.segments)) {
    const lastSegment = column.segments[column.segments.length - 1];
    if (lastSegment && String(lastSegment).toLowerCase() === normalized) return true;

    const fullName = joinFieldPath(column.segments).toLowerCase();
    if (fullName === normalized) return true;
  }

  return false;
};

const createEmptyCellValue = () => ({ display: "", search: "", sort: "", boolean: false });

export const computeRowValues = (entry, columns) => {
  const values = {};
  (columns || []).forEach((column) => {
    if (!column || !column.key) return;
    if (typeof column.getValue !== "function") {
      values[column.key] = createEmptyCellValue();
      return;
    }
    values[column.key] = column.getValue(entry, column) || createEmptyCellValue();
  });
  return values;
};

export const compareByColumn = (a, b, column, order = "asc") => {
  if (!column || column.sortable === false) return 0;
  const sortableA = a?.values?.[column.key]?.sort ?? "";
  const sortableB = b?.values?.[column.key]?.sort ?? "";
  const result = compareValues(sortableA, sortableB);
  const finalResult = order === "asc" ? result : -result;
  return finalResult;
};

export const applyDisplayLengthLimit = (text, limit) => {
  if (typeof text !== "string") return text ?? "";
  const maxLength = Number(limit);
  if (!Number.isFinite(maxLength) || maxLength <= 0) return text;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
};

export const parseSearchCellDisplayLimit = (rawValue) => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};
