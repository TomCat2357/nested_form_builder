/**
 * 検索結果一覧（view）形式の AlaSQL 行配列を生成する。
 *
 * データ形式は view 形式に一本化された（元データ形式＝選択肢ごとの真偽値列は廃止）。
 * よって本変換は、保存済み `entry.data`（= フィールドごとの 1 列・view 形式）を
 * ほぼ素通しで AlaSQL 行へ写す薄い変換になる：
 *   - radio / select: 親列に「選択肢ラベル文字列」。
 *   - checkboxes / weekday: 親列に「選択ラベルを共有 codec で連結した文字列」
 *     （区切り `,`、ラベル内の `,`/`\` はバックスラッシュでエスケープ）。MV_EQ/MV_IN UDF が
 *     同じ codec で分割するので、ラベルにカンマを含んでも集合一致が正しく働く。
 *   - date / datetime / time: canonical 文字列（date=YYYY/MM/DD / time=HH:mm:ss.SSS /
 *     datetime=YYYY/MM/DD HH:mm:ss.SSS）に整形。
 *   - number: Number 強制。
 *   - その他: data[pipePath] 素通し。
 *   - メタ列: id / No_ / createdAt / modifiedAt / createdBy / modifiedBy / deletedAt / deletedBy
 *
 * 列キーは headerKeyToAlaSqlKey で `|` → `__` 変換。
 * メタ列名がフィールドラベルと衝突した場合は最後にメタ列で上書き。
 */

import { formatCanonical } from "../../utils/dateTime.js";
import { forEachFormField } from "./utils/fieldMetas.js";

/**
 * フォーム schema を走査して、各フィールドの { path, type, alaSqlKey } 配列を返す。
 * 同一 pipePath は最初の出現を採用（先勝ち、getFormColumns と同じポリシー）。
 */
function collectViewFieldInfos(form) {
  const out = [];
  forEachFormField(form, ({ field, pipePath, alaSqlKey }) => {
    out.push({
      path: pipePath,
      type: field && field.type,
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

function fieldViewValue(entry, fieldInfo) {
  const data = (entry && typeof entry.data === "object" && entry.data) ? entry.data : {};
  const path = fieldInfo.path;
  const type = fieldInfo.type;
  const v = data[path];

  if (type === "radio" || type === "select" || type === "checkboxes" || type === "weekday") {
    // view 形式の保存値（選択肢ラベル / checkboxes は codec 連結文字列）をそのまま渡す。
    // 未選択は "" に揃える（data 形式との整合：選択肢列は空文字、非選択肢列は null）。
    return (v === undefined || v === null) ? "" : v;
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
    row._row = idx + 1;
    return row;
  });
}
