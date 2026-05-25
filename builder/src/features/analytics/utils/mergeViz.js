/**
 * 保存済み visualization に、閲覧者の一時上書きを重ねたものを作る。
 *
 * override は変更されたキーだけを持つ sparse なオブジェクト想定
 * （例: { type: "line" } / { showLegend: false } / { axis: { y: { auto: false, min: 0 } } }）。
 * axis だけは x / y それぞれを浅くマージする（min だけ上書きしても max は元設定を残すため）。
 *
 * 元の question.visualization は書き換えない（新しいオブジェクトを返す）。
 */
export function mergeViz(originalViz, override) {
  const base = originalViz && typeof originalViz === "object" ? originalViz : { type: "table" };
  if (!override || typeof override !== "object") return base;
  const merged = { ...base, ...override };
  if (override.axis && typeof override.axis === "object") {
    const baseAxis = base.axis && typeof base.axis === "object" ? base.axis : {};
    const ovAxis = override.axis;
    merged.axis = {
      ...baseAxis,
      ...ovAxis,
      ...(ovAxis.x ? { x: { ...(baseAxis.x || {}), ...ovAxis.x } } : {}),
      ...(ovAxis.y ? { y: { ...(baseAxis.y || {}), ...ovAxis.y } } : {}),
    };
  }
  return merged;
}
