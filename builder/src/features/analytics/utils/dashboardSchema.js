/**
 * Dashboard v2 スキーマヘルパ。
 *
 * v2 形状:
 * {
 *   schemaVersion: 2,
 *   id, name, description, archived,
 *   layout: { cols, rowHeight, margin: [x,y], containerPadding: [x,y] },
 *   cards: [
 *     // type === "question"（既定: 後方互換のため type フィールドが無いカードも question 扱い）
 *     // 参照は questionId（＝fileId）のみ。リンク切れ時の復旧は中央辞書（論理パス→fileId）が担う。
 *     // questionName は旧データに残り得るが書き込まない（読取時は無視＝寛容）。
 *     { id, type?: "question", questionId, title, x, y, w, h, minW, minH, filterMappings? },
 *     // type === "message" — ダッシュボード上で直接編集できるメッセージボックス
 *     { id, type: "message", text, fontSize, color, background, align,
 *       x, y, w, h, minW, minH },
 *   ],
 *   filters: [{ id, label, type, default, options? }],
 *   simpleFilters: [{ id, column, label, valueType }],  // 簡易フィルタ（最大3）。元レコードテーブルへ min/max を適用
 *   driveFileUrl, createdAt, modifiedAt,
 * }
 *
 * フィルタ type: "dateRange" | "category" | "text" | "number" | "numberRange"
 * 簡易フィルタ valueType: "number" | "date" | "text"（フォーム schema のフィールド型に由来）
 */

import {
  DEFAULT_FONT_SIZE_PX,
  DEFAULT_COLOR_KEY,
  DEFAULT_BACKGROUND_KEY,
  DEFAULT_ALIGN_KEY,
} from "../constants/messageCardPresets.js";

export const CARD_TYPE_QUESTION = "question";
export const CARD_TYPE_MESSAGE = "message";

/**
 * カードの種別を取得する。type 未指定（旧データ）は "question" として扱う。
 */
export function getCardType(card) {
  return card && card.type === CARD_TYPE_MESSAGE ? CARD_TYPE_MESSAGE : CARD_TYPE_QUESTION;
}

export const DEFAULT_LAYOUT = {
  cols: 12,
  rowHeight: 60,
  margin: [8, 8],
  containerPadding: [0, 0],
};

// h は RGL の行数。rowHeight 60px なので h:6 ≒ 360px。ChartRenderer の
// グラフ領域が高さ 300px 固定で、カードヘッダ込みでこれより低いと X 軸ラベルが
// クリップされる（ダッシュボード表示時のみ。Question エディタは縦制限なし）。
export const DEFAULT_CARD_SIZE = { w: 6, h: 6, minW: 2, minH: 3 };

export const FILTER_TYPES = ["dateRange", "category", "text", "number", "numberRange"];

// 簡易フィルタの最大件数（3項目まで、項目間は AND）。
export const MAX_SIMPLE_FILTERS = 3;
// 簡易フィルタの値の型（フォーム schema 由来）。
export const SIMPLE_FILTER_VALUE_TYPES = ["number", "date", "text"];

export function isV2(dashboard) {
  return !!dashboard && dashboard.schemaVersion === 2;
}

export function createEmptyV2({ id = null, name = "", description = "" } = {}) {
  return {
    schemaVersion: 2,
    id,
    name,
    description,
    folder: "",
    archived: false,
    layout: { ...DEFAULT_LAYOUT, margin: [...DEFAULT_LAYOUT.margin], containerPadding: [...DEFAULT_LAYOUT.containerPadding] },
    cards: [],
    filters: [],
    simpleFilters: [],
  };
}

/**
 * 簡易フィルタの既定入力値。閲覧時に min / max を入力する。
 */
export function defaultSimpleFilterValue() {
  return { min: null, max: null };
}

export function defaultFilterValue(filter) {
  if (!filter) return null;
  if (filter.default !== undefined && filter.default !== null) return filter.default;
  switch (filter.type) {
    case "dateRange": return { from: null, to: null };
    case "numberRange": return { min: null, max: null };
    case "category": return filter.options?.multi ? [] : "";
    case "text": return "";
    case "number": return null;
    default: return null;
  }
}

export function assertV2(dashboard) {
  if (!dashboard || typeof dashboard !== "object") {
    throw new Error("Dashboard が空です");
  }
  if (dashboard.schemaVersion !== 2) {
    throw new Error("Dashboard の schemaVersion は 2 である必要があります (received: " + dashboard.schemaVersion + ")");
  }
  if (!Array.isArray(dashboard.cards)) {
    throw new Error("Dashboard.cards は配列である必要があります");
  }
  if (!Array.isArray(dashboard.filters)) {
    throw new Error("Dashboard.filters は配列である必要があります");
  }
  for (const card of dashboard.cards) {
    if (!card || typeof card !== "object") throw new Error("card が不正です");
    if (!card.id) throw new Error("card.id がありません");
    if (typeof card.x !== "number" || typeof card.y !== "number") {
      throw new Error("card.x / card.y が数値ではありません: " + card.id);
    }
    if (typeof card.w !== "number" || typeof card.h !== "number") {
      throw new Error("card.w / card.h が数値ではありません: " + card.id);
    }
  }
  for (const f of dashboard.filters) {
    if (!f || !f.id) throw new Error("filter.id がありません");
    if (!FILTER_TYPES.includes(f.type)) {
      throw new Error("未対応の filter.type です: " + f.type);
    }
  }
  // simpleFilters は後方互換のため未定義（undefined）を許容する（= 旧データ）。
  if (dashboard.simpleFilters !== undefined) {
    if (!Array.isArray(dashboard.simpleFilters)) {
      throw new Error("Dashboard.simpleFilters は配列である必要があります");
    }
    if (dashboard.simpleFilters.length > MAX_SIMPLE_FILTERS) {
      throw new Error("簡易フィルタは最大 " + MAX_SIMPLE_FILTERS + " 件までです");
    }
    for (const sf of dashboard.simpleFilters) {
      if (!sf || !sf.id) throw new Error("simpleFilter.id がありません");
      if (!sf.column) throw new Error("simpleFilter.column がありません: " + sf.id);
    }
  }
}

/**
 * メッセージカード生成用のデフォルト値。
 * computeDefaultCardPosition は呼び出し側で組み合わせる。
 */
export function createMessageCardDefaults() {
  return {
    type: CARD_TYPE_MESSAGE,
    text: "",
    fontSize: DEFAULT_FONT_SIZE_PX,
    color: DEFAULT_COLOR_KEY,
    background: DEFAULT_BACKGROUND_KEY,
    align: DEFAULT_ALIGN_KEY,
  };
}

/**
 * 新規カードのデフォルト位置を計算する。
 * 既存カードの最大 y+h に積む（上から下へ流す）。x=0 / w=6 / h=4。
 */
export function computeDefaultCardPosition(existingCards, { w = DEFAULT_CARD_SIZE.w, h = DEFAULT_CARD_SIZE.h } = {}) {
  let maxBottom = 0;
  for (const c of existingCards || []) {
    const bottom = (c.y || 0) + (c.h || 0);
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return { x: 0, y: maxBottom, w, h, minW: DEFAULT_CARD_SIZE.minW, minH: DEFAULT_CARD_SIZE.minH };
}

/**
 * RGL の onLayoutChange 出力 [{ i, x, y, w, h }] を cards にマージする。
 */
export function mergeLayoutIntoCards(cards, rglLayout) {
  if (!Array.isArray(rglLayout)) return cards;
  const byId = new Map(rglLayout.map((l) => [l.i, l]));
  return cards.map((c) => {
    const l = byId.get(c.id);
    if (!l) return c;
    return { ...c, x: l.x, y: l.y, w: l.w, h: l.h };
  });
}
