/**
 * 検索結果一覧（view）形式の AlaSQL 行配列を生成する。
 *
 * スプレッドシート由来の data 形式（entriesToAlaSqlRows）との違い：
 *   - radio / select: 親列に「選択肢ラベル文字列」を入れる。option 真偽値列 (`path|opt`) は出さない
 *   - checkboxes / weekday: 親列に「選択ラベルをカンマ "," 連結した文字列」。option 真偽値列は出さない
 *   - date / datetime / time: data 形式と同じ canonical 文字列（date=YYYY/MM/DD / time=HH:mm:ss.SSS / datetime=YYYY/MM/DD HH:mm:ss.SSS）
 *   - number: Number 強制（data 形式と同じ）
 *   - その他: data[pipePath] 素通し
 *   - メタ列: id / No_ / createdAt / modifiedAt / createdBy / modifiedBy / deletedAt / deletedBy
 *
 * 列キーは headerKeyToAlaSqlKey で `|` → `__` 変換（data 形式と同じ命名規則）。
 * メタ列名がフィールドラベルと衝突した場合は最後にメタ列で上書き（data 形式と同じ挙動）。
 */

import { isChoiceMarkerValue } from "../../utils/responses.js";
import { collectDirectOptionLabels } from "../search/searchTableValues.js";
import { formatCanonical } from "../../utils/dateTime.js";
import { forEachFormField, extractOptionOrder } from "./utils/fieldMetas.js";

/**
 * フォーム schema を走査して、各フィールドの { path, type, optionOrder, alaSqlKey } 配列を返す。
 * 同一 pipePath は最初の出現を採用（先勝ち、getFormColumns と同じポリシー）。
 */
function collectViewFieldInfos(form) {
  const out = [];
  forEachFormField(form, ({ field, pipePath, alaSqlKey }) => {
    out.push({
      path: pipePath,
      type: field && field.type,
      optionOrder: extractOptionOrder(field),
      alaSqlKey,
    });
  });
  return out;
}

/**
 * radio / select 1 列の view 値を求める。
 *   - data[path] に「ラベル文字列」が直接入っていればそれを採用（新形式）
 *   - data[path] が choice marker (●/true/1) なら option markers から選択ラベルを引く
 *   - data[path] が無ければ option markers から引く
 *   - どれも無ければ ""（null ではなく空文字、データ形式と整合）
 */
function radioSelectViewValue(data, path, optionOrder) {
  const direct = data[path];
  const hasDirect = Object.prototype.hasOwnProperty.call(data, path);
  if (hasDirect && direct !== "" && direct != null && !isChoiceMarkerValue(direct)) {
    return direct;
  }
  const labels = collectDirectOptionLabels(data, path, optionOrder);
  if (labels.length > 0) return labels[0];
  return "";
}

function checkboxViewValue(data, path, optionOrder) {
  const labels = collectDirectOptionLabels(data, path, optionOrder);
  if (labels.length === 0) return "";
  return labels.join(",");
}

function coerceNumberOrNull(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fieldViewValue(entry, fieldInfo) {
  const data = (entry && typeof entry.data === "object" && entry.data) ? entry.data : {};
  const path = fieldInfo.path;
  const type = fieldInfo.type;

  if (type === "radio" || type === "select") {
    return radioSelectViewValue(data, path, fieldInfo.optionOrder);
  }
  if (type === "checkboxes" || type === "weekday") {
    return checkboxViewValue(data, path, fieldInfo.optionOrder);
  }
  if (type === "date") {
    const v = data[path];
    if (v === "" || v == null) return null;
    return formatCanonical(v, "date") ?? null;
  }
  if (type === "datetime") {
    const v = data[path];
    if (v === "" || v == null) return null;
    return formatCanonical(v, "datetime") ?? null;
  }
  if (type === "time") {
    const v = data[path];
    if (v === "" || v == null) return null;
    return formatCanonical(v, "time") ?? null;
  }
  if (type === "number") {
    return coerceNumberOrNull(data[path]);
  }
  // text / textarea / email / tel / url / file / その他: 素通し
  const v = data[path];
  return v === undefined ? null : v;
}

/**
 * entries（dataStore.listEntries の出力）→ view 形式の AlaSQL 行配列。
 *
 * @param {Array} entries
 * @param {object} form - スキーマ走査用フォーム本体
 */
export function entriesToViewTableRows(entries, form) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const fieldInfos = collectViewFieldInfos(form);

  return entries.map((entry, idx) => {
    const row = {};
    // 同一 alaSqlKey の重複に備えて、まず全 field を null 初期化（SELECT * が schema 全列を返すように）
    for (const fi of fieldInfos) {
      row[fi.alaSqlKey] = null;
    }
    for (const fi of fieldInfos) {
      row[fi.alaSqlKey] = fieldViewValue(entry, fi);
    }
    // メタ列（data 形式と同じセット・命名）。フィールド由来の同名列を上書きする。
    row.id = entry?.id || "";
    row["No_"] = entry?.["No."] ?? "";
    row.createdAt = formatCanonical(entry?.createdAt, "datetime") ?? null;
    row.modifiedAt = formatCanonical(entry?.modifiedAt, "datetime") ?? null;
    row.deletedAt = formatCanonical(entry?.deletedAt, "datetime") ?? null;
    row.createdBy = entry?.createdBy ?? "";
    row.modifiedBy = entry?.modifiedBy ?? "";
    row.deletedBy = entry?.deletedBy ?? "";
    row._row = idx + 1;
    return row;
  });
}
