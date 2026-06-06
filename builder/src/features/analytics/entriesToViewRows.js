/**
 * 検索結果一覧（view）形式の AlaSQL 行配列を生成する。
 *
 * スプレッドシート保存は元データ方式（選択肢ごとのマーカー列 `親|選択肢`: ●）。本変換は
 * その raw な `entry.data` を読取り、選択肢を **view 形式**（フィールド 1 列のラベル文字列）へ
 * 畳み込んで AlaSQL 行を作る（view 期に保存された直接列データとも両対応）：
 *   - radio / select: 親列に「選択肢ラベル文字列」（マーカー列から集約。直接ラベルもそのまま採用）。
 *   - checkboxes: 親列に「選択ラベルを共有 codec で連結した文字列」
 *     （区切り `,`、ラベル内の `,`/`\` はバックスラッシュでエスケープ）。MV_EQ/MV_IN UDF が
 *     同じ codec で分割するので、ラベルにカンマを含んでも集合一致が正しく働く。
 *   - date / datetime / time: canonical 文字列（date=YYYY-MM-DD / time=HH:mm:ss.SSS /
 *     datetime=YYYY-MM-DD_HH:mm:ss.SSS、日付↔時刻は `_` 区切り）に整形。
 *   - number: Number 強制。
 *   - その他: data[pipePath] 素通し。
 *   - メタ列: id / No_ / createdAt / modifiedAt / createdBy / modifiedBy / deletedAt / deletedBy / pid
 *
 * 列キーは headerKeyToAlaSqlKey で `|` → `__` 変換。
 * メタ列名がフィールドラベルと衝突した場合は最後にメタ列で上書き。
 */

import { isChoiceMarkerValue } from "../../utils/responses.js";
import { collectDirectOptionLabels } from "../search/searchTableValues.js";
import { formatCanonical } from "../../utils/dateTime.js";
import { forEachFormField, extractOptionOrder } from "./utils/fieldMetas.js";
import { joinMultiValue } from "../../utils/multiValue.js";

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

function coerceNumberOrNull(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * radio / select 1 列の view 値を求める。
 *   - 元データ方式: 選択肢マーカー列（`親|選択肢`: ●）から選択ラベルを引く。
 *   - view 期データ互換: data[path] にラベル文字列が直接入っていればそれを採用。
 *   - どれも無ければ ""（null ではなく空文字、選択肢列の整合）。
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

/**
 * checkboxes 1 列の view 値を求める。選択ラベルを共有 codec で連結（MV_EQ/MV_IN と同形式）。
 *   - 元データ方式: 選択肢マーカー列から集約。
 *   - view 期データ互換: data[path] が codec 連結文字列ならそのまま採用。
 */
function checkboxViewValue(data, path, optionOrder) {
  const labels = collectDirectOptionLabels(data, path, optionOrder);
  if (labels.length > 0) return joinMultiValue(labels);
  const direct = data[path];
  if (typeof direct === "string" && direct !== "") return direct;
  return "";
}

function fieldViewValue(entry, fieldInfo) {
  const data = (entry && typeof entry.data === "object" && entry.data) ? entry.data : {};
  const path = fieldInfo.path;
  const type = fieldInfo.type;
  const v = data[path];

  if (type === "radio" || type === "select") {
    return radioSelectViewValue(data, path, fieldInfo.optionOrder);
  }
  if (type === "checkboxes") {
    return checkboxViewValue(data, path, fieldInfo.optionOrder);
  }
  if (type === "date") {
    if (v === "" || v == null) return null;
    return formatCanonical(v, "date") ?? null;
  }
  if (type === "datetime") {
    if (v === "" || v == null) return null;
    return formatCanonical(v, "datetime") ?? null;
  }
  if (type === "time") {
    if (v === "" || v == null) return null;
    return formatCanonical(v, "time") ?? null;
  }
  if (type === "number") {
    return coerceNumberOrNull(v);
  }
  // text / textarea / email / tel / url / file / その他: 素通し
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
    row.pid = entry?.pid ?? "";
    row._row = idx + 1;
    return row;
  });
}
