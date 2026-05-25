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
import { CHOICE_TYPES } from "../../../utils/responses.js";

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
 * choice 系フィールド（checkboxes / radio / select / weekday）の各選択肢を
 * `親|選択肢` の列として走査する。スプレッドシートでは選択肢ごとに
 * `親|選択肢` 列（`●`/空白マーカー）が立つので、その boolean 列を列挙する用途。
 *
 * 各 callback は `{ field, fieldSegs, optionLabel, segs, pipePath, alaSqlKey }` を受け取る。
 * 同一 pipePath（フィールド × 選択肢）は最初の出現のみ通る（先勝ち）。
 */
export function forEachChoiceOption(form, callback) {
  if (!form || !Array.isArray(form.schema) || typeof callback !== "function") return;
  const seen = new Set();
  traverseSchema(form.schema, (field, ctx) => {
    if (!field || !CHOICE_TYPES.has(field.type)) return;
    const fieldSegs = (ctx && Array.isArray(ctx.pathSegments)) ? ctx.pathSegments : [];
    const fieldPipePath = fieldSegs.join("|");
    if (!fieldPipePath) return;
    const options = extractOptionOrder(field);
    if (!options) return;
    for (const optionLabel of options) {
      if (typeof optionLabel !== "string" || optionLabel === "") continue;
      const pipePath = fieldPipePath + "|" + optionLabel;
      if (seen.has(pipePath)) continue;
      seen.add(pipePath);
      callback({
        field,
        fieldSegs,
        optionLabel,
        segs: [...fieldSegs, optionLabel],
        pipePath,
        alaSqlKey: headerKeyToAlaSqlKey(pipePath),
      });
    }
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
