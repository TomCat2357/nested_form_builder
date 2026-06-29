/**
 * エンティティ間の参照（リンク）関係を宣言的に集約する単一の真実源。
 *
 * これまで「クエスチョン → フォーム」「ダッシュボード → クエスチョン」という参照の
 * 抽出・付け替え・子キャッシュ走査は、entityType ごとの手書き条件分岐として
 * uploadQueue.js / uploadWorker.js に散らばっていた。新しい参照フィールドを足すたびに
 * 複数箇所の if 分岐を直す必要があり、漏れがバグになりやすかった。
 *
 * ここでは各エンティティの参照を `path`（payload 内の場所）+ `targetType`（参照先の型）の
 * 宣言として持ち、汎用ウォーカーで抽出・書き換えする。新規参照は ENTITY_SCHEMA に 1 行
 * 足すだけで、収集・依存解決・remap・子キャッシュ走査がすべて自動で追従する。
 *
 * path 記法:
 *   "query.gui.formId"             … ネストしたオブジェクトのリーフ
 *   "query.formSources[].formId"  … 配列を辿って各要素のリーフ（"[]" が配列展開）
 *   "cards[].questionId"          … 同上
 */

/**
 * @typedef {{ path: string, targetType: string }} EntityRef
 * @typedef {{ refs: EntityRef[] }} EntitySpec
 */

/** @type {Record<string, EntitySpec>} */
export const ENTITY_SCHEMA = {
  // フォームは他エンティティを参照しない（参照される側）。
  form: { refs: [] },
  // クエスチョンはデータソースとしてフォームを参照する。
  question: {
    refs: [
      { path: "query.gui.formId", targetType: "form" },
      { path: "query.formSources[].formId", targetType: "form" },
    ],
  },
  // ダッシュボードはカードごとにクエスチョンを参照する。
  dashboard: {
    refs: [{ path: "cards[].questionId", targetType: "question" }],
  },
};

// path 文字列をセグメント配列へ。"[]" 付きセグメントは配列展開マーカー。
const parsePath = (path) => path.split(".");

// path セグメントを辿り、参照値を持つリーフ（保持オブジェクト obj とフィールド名 field）ごとに
// leafFn(obj, field) を呼ぶ。配列セグメント（末尾 "[]"）は要素ごとに残りを辿る。
const walkRefLeaves = (obj, segments, leafFn) => {
  if (!obj || typeof obj !== "object") return;
  const head = segments[0];
  const rest = segments.slice(1);
  if (head.endsWith("[]")) {
    const arr = obj[head.slice(0, -2)];
    if (!Array.isArray(arr)) return;
    for (const el of arr) walkRefLeaves(el, rest, leafFn);
    return;
  }
  if (rest.length === 0) {
    leafFn(obj, head);
    return;
  }
  walkRefLeaves(obj[head], rest, leafFn);
};

/**
 * payload が参照する ID 群を ENTITY_SCHEMA に従って収集する（重複はそのまま）。
 * @param {string} entityType
 * @param {object} payload
 * @returns {string[]}
 */
export const collectReferencedIds = (entityType, payload) => {
  const spec = ENTITY_SCHEMA[entityType];
  if (!spec || !payload) return [];
  const ids = [];
  for (const ref of spec.refs) {
    walkRefLeaves(payload, parsePath(ref.path), (obj, field) => {
      if (obj[field]) ids.push(obj[field]);
    });
  }
  return ids;
};

/**
 * remap = { [oldId]: newId } を payload の参照フィールドへ適用する。変更があれば true。
 * @param {string} entityType
 * @param {object} payload
 * @param {Record<string, string>} remap
 * @returns {boolean}
 */
export const applyRefRemapToPayload = (entityType, payload, remap) => {
  if (!payload || !remap || Object.keys(remap).length === 0) return false;
  const spec = ENTITY_SCHEMA[entityType];
  if (!spec) return false;
  let changed = false;
  for (const ref of spec.refs) {
    walkRefLeaves(payload, parsePath(ref.path), (obj, field) => {
      const cur = obj[field];
      if (cur && remap[cur]) {
        obj[field] = remap[cur];
        changed = true;
      }
    });
  }
  return changed;
};

/**
 * targetType を参照する子エンティティ型の一覧を返す（逆引き）。
 * 例: childEntityTypesReferencing("form") -> ["question"]
 *     childEntityTypesReferencing("question") -> ["dashboard"]
 * @param {string} targetType
 * @returns {string[]}
 */
export const childEntityTypesReferencing = (targetType) => {
  const out = [];
  for (const type of Object.keys(ENTITY_SCHEMA)) {
    if (ENTITY_SCHEMA[type].refs.some((ref) => ref.targetType === targetType)) {
      out.push(type);
    }
  }
  return out;
};
