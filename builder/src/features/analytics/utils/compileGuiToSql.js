/**
 * 旧 GUI スキーマ (v1) のコンパイルを新パイプライン (compileStages) にデリゲートする薄ラッパ。
 *
 * v1 形式 (`{ formId, aggregations, groupBy, filters, orderBy, limit }`) を
 * `migrateLegacyGui` で v2 stages 配列に変換し、`compileStages` を呼ぶ。
 *
 * 後方互換のため v1 が要求していた前段バリデーション（formId 必須・aggregations 必須）も
 * ここで行う。compileStages 自体は raw mode（aggregations 0）も許容する。
 *
 * Step 7 で完全削除予定。
 */
import { migrateLegacyGui } from "./migrateLegacyGui.js";
import { compileStages } from "./compileStages.js";

export function compileGuiToSql(gui, opts) {
  const errors = [];

  if (!gui || !gui.formId) errors.push("フォームが選択されていません");
  const aggs = Array.isArray(gui?.aggregations) ? gui.aggregations : [];
  if (aggs.length === 0) errors.push("集計を 1 つ以上追加してください");

  if (errors.length > 0) return { ok: false, errors };

  const v2 = migrateLegacyGui(gui);
  return compileStages(v2, opts);
}
