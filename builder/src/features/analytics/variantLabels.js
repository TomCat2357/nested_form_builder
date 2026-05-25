// データソース形式（variant）の表示ラベル・説明を一元管理する。
// コード値は "data" / "view"（変更不可）。UI ラベルは全画面でここを参照すること。
export const VARIANT_DATA = "data";
export const VARIANT_VIEW = "view";

export const VARIANT_LABELS = {
  data: "元データ形式",
  view: "ビュー形式",
};

export const VARIANT_DESCRIPTIONS = {
  data: "スプレッドシートそのまま。選択肢ごとに ● 真偽値列が並ぶ。",
  view: "ラジオ／チェックは選択肢ラベルが入った 1 列。メタ列 (id, No., createdAt 等) 付き。",
};

// 任意の入力を正規化（未指定・不正は "data"）。
export function normalizeVariant(v) {
  return v === "view" ? "view" : "data";
}
