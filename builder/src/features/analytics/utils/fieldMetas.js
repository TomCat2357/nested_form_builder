/**
 * フォーム schema の走査結果を共通化するヘルパー。
 *
 * analyticsSchemaColumns.js（列メタ生成 / 型マップ）と entriesToViewRows.js
 * （view 形式の行整形）で同じ「traverseSchema + 先勝ち重複排除 + pipePath 計算
 *  + alaSqlKey 計算」が4箇所重複していたため、ここに集約する。
 *
 * 各 callback は `{ field, segs, pipePath, alaSqlKey }` を受け取る。
 * `pipePath` が空文字のフィールド（不正な空 schema 等）は callback に渡らない。
 * 同一 pipePath は最初の出現のみ通る（先勝ち）。
 */

import { traverseSchema } from "../../../core/schemaUtils.js";
import { headerKeyToAlaSqlKey } from "./headerToAlaSqlKey.js";

export function forEachFormField(form, callback) {
  if (!form || !Array.isArray(form.schema) || typeof callback !== "function") return;
  const seen = new Set();
  traverseSchema(form.schema, (field, ctx) => {
    const segs = (ctx && Array.isArray(ctx.pathSegments)) ? ctx.pathSegments : [];
    const pipePath = segs.join("|");
    if (!pipePath || seen.has(pipePath)) return;
    seen.add(pipePath);
    callback({
      field,
      segs,
      pipePath,
      alaSqlKey: headerKeyToAlaSqlKey(pipePath),
    });
  });
}

/**
 * field.options を ラベル配列に正規化する（先頭が "" のもの・undefined 等は除外）。
 * schema.js で options は { label, defaultSelected } 形式に正規化されるが、旧データの
 * 素朴な文字列配列 / 部分的なオブジェクトを吸収するためにここで対応する。
 */
export function extractOptionOrder(field) {
  if (!field || !Array.isArray(field.options)) return null;
  const labels = field.options
    .map((o) => (typeof o === "string" ? o : (o && o.label)))
    .filter((s) => typeof s === "string" && s !== "");
  return labels.length > 0 ? labels : null;
}
