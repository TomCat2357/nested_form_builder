import { dashboardHelpers } from "./aggregate.js";

/**
 * ユーザーが書いたコードを実行して、描画記述子 (spec) を返す。
 *
 * - "use strict" で実行 (window/document などへ未宣言のグローバル代入を防ぐ)
 * - 引数 ctx には records / forms / helpers / chart / table のヘルパだけ渡す
 * - 戻り値は シリアライズ可能な spec オブジェクト ({ kind: "chart" | "table" | "stats", ... }) を期待する
 *   React 要素をそのまま返すパスは設けない（XSS / 任意 props 注入を避ける）。
 *
 * @param {string} code  ユーザーコード本体（function body 相当）
 * @param {object} input { records, forms, formsById, recordsByForm, selectedFormIds }
 * @returns {{ ok: boolean, spec?: any, error?: string }}
 */
export function runCustomCodeCell(code, input) {
  const ctx = buildContext(input);
  let fn;
  try {
    fn = new Function("ctx", `"use strict"; ${code}`);
  } catch (err) {
    return { ok: false, error: `構文エラー: ${err?.message || err}` };
  }
  try {
    const spec = fn(ctx);
    if (!spec) {
      return { ok: false, error: "spec が返されませんでした (return が必要です)" };
    }
    if (typeof spec !== "object") {
      return { ok: false, error: `spec は object である必要があります (got ${typeof spec})` };
    }
    return { ok: true, spec: normalizeSpec(spec) };
  } catch (err) {
    return { ok: false, error: `実行時エラー: ${err?.message || err}` };
  }
}

const buildContext = ({ records, forms, formsById, recordsByForm, selectedFormIds }) => {
  return {
    records: Array.isArray(records) ? records : [],
    forms: Array.isArray(forms) ? forms : [],
    formsById: formsById || {},
    recordsByForm: recordsByForm || {},
    selectedFormIds: Array.isArray(selectedFormIds) ? selectedFormIds : [],
    helpers: dashboardHelpers,
    chart: {
      bar: ({ data, xKey = "name", yKey = "value", title } = {}) => ({
        kind: "chart",
        type: "bar",
        data: Array.isArray(data) ? data : [],
        xKey,
        yKey,
        title: title || "",
      }),
      line: ({ data, xKey = "name", yKey = "value", title } = {}) => ({
        kind: "chart",
        type: "line",
        data: Array.isArray(data) ? data : [],
        xKey,
        yKey,
        title: title || "",
      }),
      pie: ({ data, nameKey = "name", valueKey = "value", title } = {}) => ({
        kind: "chart",
        type: "pie",
        data: Array.isArray(data) ? data : [],
        nameKey,
        valueKey,
        title: title || "",
      }),
    },
    table: ({ rows, columns, title } = {}) => ({
      kind: "table",
      rows: Array.isArray(rows) ? rows : [],
      columns: Array.isArray(columns) ? columns : [],
      title: title || "",
    }),
    text: (message) => ({ kind: "text", message: String(message ?? "") }),
  };
};

const normalizeSpec = (spec) => {
  if (!spec || typeof spec !== "object") return spec;
  // 念のため、関数や React 要素的な値を弾く
  return JSON.parse(JSON.stringify(spec));
};
