/**
 * viz（保存済み visualization）と結果列メタから、軸スケール UI（AxisRangeControls）と
 * 凡例トグルを出すための情報を求める共有ロジック。
 * VisualizePanel（管理者エディタ）と CardVizOverridePanel（閲覧者の一時上書き）で共有する。
 */

import { detectColumnType } from "./columnValueInference.js";
import { resolveColumnKey } from "./metaColumnDisplay.js";
import { AXIS_TYPES, LEGEND_TYPES } from "./suggestChartType.js";

/**
 * @param {object} args
 *   type            … viz.type（"bar" など）
 *   xField          … X 軸の列名（表示ラベルでも可。内部で resolveColumnKey で正規化する）
 *   yFields         … Y 軸の列名配列（表示ラベルでも可。CSV 文字列は呼び出し側で配列にしておく）
 *   columns         … 結果の生カラム配列
 *   compiledColumns … コンパイル済みカラムメタ
 *   fallbackTypeMap … schema 由来の型マップ（無ければ null）
 *   yTypeWhenEmpty  … yFields が空のときの Y 軸型の既定値。
 *                     エディタは null（明示されるまで軸 UI を出さない）、
 *                     閲覧者の上書きは "number"（既定の集計結果は数値とみなして軸 UI を出す）。
 * @returns {{ xAxisType, yAxisType, showAxis, showX, showY, showLegend }}
 */
export function detectAxisTypes({ type, xField, yFields, columns, compiledColumns, fallbackTypeMap, yTypeWhenEmpty = null }) {
  const fbm = fallbackTypeMap || null;

  const xAxisType = detectColumnType(compiledColumns, resolveColumnKey(xField, columns, compiledColumns), fbm);

  const fields = Array.isArray(yFields) ? yFields : [];
  let yAxisType;
  if (fields.length === 0) {
    yAxisType = yTypeWhenEmpty;
  } else {
    const types = fields.map((f) => detectColumnType(compiledColumns, resolveColumnKey(f, columns, compiledColumns), fbm));
    if (types.some((t) => t === null)) yAxisType = null;
    else yAxisType = types.every((t) => t === types[0]) ? types[0] : null;
  }

  return {
    xAxisType,
    yAxisType,
    showAxis: AXIS_TYPES.has(type),
    showX: type === "scatter" && xAxisType !== null,
    showY: yAxisType !== null,
    showLegend: LEGEND_TYPES.has(type),
  };
}
