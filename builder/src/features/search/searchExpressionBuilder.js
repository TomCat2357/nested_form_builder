/**
 * 検索クエリ → alasql 式 への変換 + 行データの構築。
 * useSearchPageState から呼ばれるエントリポイント。
 */
import { preprocessSearchQuery, STRICT_PREFIX_RE } from "./searchSyntaxPreprocessor.js";
import { buildSimpleSearchExpression } from "./searchSimpleTranslate.js";
import { headerKeyToAlaSqlKey } from "../analytics/utils/headerToAlaSqlKey.js";
import { columnType } from "./searchTableValues.js";
import { formatCanonical } from "../../utils/dateTime.js";
import { entriesToViewTableRows } from "../analytics/entriesToViewRows.js";
import { traverseSchema } from "../../core/schemaUtils.js";
import { splitFieldPath } from "../../utils/formPaths.js";

/**
 * 検索バーで識別子として有効な「列名」を返す。
 * - 表示列は path（ユーザーが入力する名前）を優先。
 * - メタ列（id / No. / createdAt / modifiedAt 等）は path を持たないので key を使う。
 */
function resolveSearchableName(col) {
  if (!col) return "";
  return col.path || col.key || "";
}

/**
 * 検索対象から除外する固定メタ列（簡易・strict 両モード共通ポリシー）。
 * `createdAt`（作成日時）/ `modifiedAt`（最終更新日時）は検索可として残し、
 * `createdBy` / `modifiedBy`（…By 系）と `deletedAt` / `deletedBy`（deleted 系）は除外。
 * strict モードの評価行（entriesToAlaSqlRows / entriesToViewTableRows）はこれらを
 * 全て含むため、stripNonSearchableMetaKeys で評価前に落として両モードのアクセス範囲を揃える。
 */
export const EXCLUDED_META_COLUMN_KEYS = new Set([
  "createdBy",
  "modifiedBy",
  "deletedAt",
  "deletedBy",
]);

function isExcludedMetaColumn(col) {
  if (!col) return false;
  const key = col.key || "";
  return EXCLUDED_META_COLUMN_KEYS.has(key);
}

/**
 * columns 配列から alasql 安全名のキー + 列メタを生成。
 * 検索可能でない (searchable=false) 列は除外。
 */
export function buildSearchableColumnKeys(columns) {
  if (!Array.isArray(columns)) return [];
  const keys = [];
  for (const col of columns) {
    if (!col) continue;
    if (col.searchable === false) continue;
    if (isExcludedMetaColumn(col)) continue;
    const name = resolveSearchableName(col);
    if (!name) continue;
    keys.push(headerKeyToAlaSqlKey(name));
  }
  return keys;
}

/**
 * 列の日付系 canonical kind を返す。日付系でなければ null。
 *   - schema の date / time フィールド → その kind
 *   - 固定メタ列 modifiedAt / createdAt → "datetime"
 * view / data どちらの行も canonical 文字列で日付を持つため、variant に依存しない。
 */
function dateLikeKind(col) {
  const type = columnType(col);
  if (type === "date" || type === "time") return type;
  if (col?.key === "modifiedAt" || col?.key === "createdAt") return "datetime";
  return null;
}

/**
 * preprocessor に渡す列メタ情報。識別子解決と日付型比較変換に使う。
 * view / data 両モードとも日付列は canonical 文字列を持つので、同じく日付列として扱い
 * （isDateLike + kind）、文字列としての日付比較に倒す。
 */
function buildSearchableColumnMeta(columns) {
  if (!Array.isArray(columns)) return [];
  const meta = [];
  for (const col of columns) {
    if (!col) continue;
    if (col.searchable === false) continue;
    if (isExcludedMetaColumn(col)) continue;
    const name = resolveSearchableName(col);
    if (!name) continue;
    meta.push({
      name,
      safeKey: headerKeyToAlaSqlKey(name),
      sourceType: col.sourceType || col.type || "",
      isDateLike: !!dateLikeKind(col),
    });
  }
  return meta;
}

/**
 * クエリ文字列 → { expr, errors }
 *
 * モード:
 * - 厳密モード（先頭 `SEARCH`/`WHERE`）: searchSyntaxPreprocessor（alasql 標準 WHERE 節）。
 * - 簡易モード（プレフィックスなし）: searchSimpleTranslate（正規表現 / 複数値集合分解などを
 *   alasql WHERE 式へ忠実に翻訳。トークナイザ/パーサは searchQueryEngine と共有）。
 *
 * 日付列は view / data 両モードとも canonical 文字列として文字列比較する（variant 非依存）。
 * @param {string} query
 * @param {Array<{ key: string, path?: string, sourceType?: string, type?: string, searchable?: boolean }>} columns
 */
export function buildSearchExpression(query, columns) {
  if (STRICT_PREFIX_RE.test(String(query == null ? "" : query))) {
    const meta = buildSearchableColumnMeta(columns);
    return preprocessSearchQuery(query, meta);
  }
  return buildSimpleSearchExpression(query, columns);
}

/**
 * 表示列 (columns) と schema 全列 (schemaCols) を path / key で dedup マージする。
 * 表示列を先頭に保持し、schema 側にしかない非表示列を後ろに追加する。
 * ALASQL モード WHERE で非表示列条件を効かせるための行 dict 構築に使う。
 */
export function mergeDisplayAndSchemaColumns(columns, schemaCols) {
  const hasColumns = Array.isArray(columns) && columns.length > 0;
  const hasSchema = Array.isArray(schemaCols) && schemaCols.length > 0;
  if (!hasColumns) return hasSchema ? schemaCols : [];
  const seenPaths = new Set();
  const seenKeys = new Set();
  const merged = [];
  for (const col of columns) {
    if (!col) continue;
    merged.push(col);
    if (col.path) seenPaths.add(col.path);
    if (col.key) seenKeys.add(col.key);
  }
  if (!hasSchema) return merged;
  for (const col of schemaCols) {
    if (!col) continue;
    if (col.path && seenPaths.has(col.path)) continue;
    if (col.key && seenKeys.has(col.key)) continue;
    merged.push(col);
  }
  return merged;
}

/**
 * フォーム schema を走査して、表示状態に依存しない全 searchable 列を返す。
 * useSearchPageState から buildSearchRow に渡す「行 dict に入れる列」用。
 * 列構造は createDisplayColumn 互換の最小形（key/path/sourceType/searchable）。
 *
 * 用途: 検索 ALASQL モードで非表示列に対する `IS NOT NULL` / `=` / `LIKE` 等を効かせる。
 * LIKE_ANY 等の列無し OR 展開（buildSearchExpression 側）には使わない — そちらは表示列のみ対象。
 */
export function buildAllSearchableColumns(form) {
  const out = [];
  const seen = new Set();
  traverseSchema(form?.schema || [], (field, ctx) => {
    if (!field || typeof field !== "object") return;
    const segments = Array.isArray(ctx?.pathSegments) ? ctx.pathSegments : [];
    const path = segments.join("|");
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push({
      key: "display:" + path,
      segments: splitFieldPath(path),
      path,
      sourceType: field.type || "",
      searchable: true,
    });
  });
  return out;
}

/**
 * view 形式の行データを作る。Question の `FROM [<フォーム名>:view]` と同じく
 * entriesToViewTableRows() の出力をそのまま AlaSQL 行として使う。
 * （radio/select → ラベル文字列、checkboxes → 「、」連結、date/datetime → canonical 文字列）
 *
 * @param {{ entry: object }} row useSearchPageState の processedEntries 要素
 * @param {object} form スキーマ走査用フォーム本体
 */
export function buildSearchRowView(row, form) {
  if (!row || !row.entry || !form) return {};
  const rows = entriesToViewTableRows([row.entry], form);
  return rows[0] || {};
}

/**
 * row.values と row.entry.data から alasql 評価用のフラット行を作る。
 * 各列キーは AlaSQL 安全名（__ 化）。
 * 表示列は path（ユーザーが入力する名前）ベースのキーで露出する。
 *
 * 日付/時刻列は canonical 文字列（date=`YYYY/MM/DD` / time=`HH:mm:ss.SSS` /
 * datetime メタ=`YYYY/MM/DD HH:mm:ss.SSS`）で渡し、文字列としての日付比較に倒す
 * （表示文字列は cell.display 経由で別途）。view モード行（entriesToViewTableRows）と同形式。
 */
export function buildSearchRow(row, columns) {
  const out = {};
  if (!row) return out;
  const values = row.values || {};
  const entry = row.entry || {};
  const dataUnixMs = entry.dataUnixMs || {};
  for (const col of columns || []) {
    if (!col) continue;
    if (isExcludedMetaColumn(col)) continue;
    const name = resolveSearchableName(col);
    if (!name) continue;
    const safeKey = headerKeyToAlaSqlKey(name);

    // 日付/時刻列は canonical 文字列で alasql に渡す（表示は cell.display 経由）
    const kind = dateLikeKind(col);
    if (kind) {
      let raw = null;
      if (col.path) {
        // 表示列（schema 由来）: dataUnixMs キャッシュ（数値）→ entry.data 文字列の順
        const cached = dataUnixMs[col.path];
        raw = Number.isFinite(cached) ? cached : entry.data?.[col.path];
      } else {
        // 固定メタ列（modifiedAt / createdAt 等）: entry 直下から読む
        raw = entry[col.key];
      }
      out[safeKey] = formatCanonical(raw, kind) ?? null;
      continue;
    }

    const cell = values[col.key];
    if (cell && typeof cell === "object") {
      // sort は型保持された値 (数値/文字列)、display は表示用文字列
      // 数値比較が必要な場合 sort を優先、ない場合 display。
      // 空欄は SQL の NULL と等価に扱う：cell.sort === null（フィールド未定義）も
      // cell.sort === ""（ユーザー入力空文字）も alasql 行では同じ null として渡し、
      // `列名 IS NULL` で両方を拾えるようにする。
      // cell.sort 側の null / "" の区別はソート（compareByColumn）用に保持されたまま。
      const sortIsMeaningful = cell.sort !== undefined && cell.sort !== "" && cell.sort !== null;
      if (sortIsMeaningful) {
        out[safeKey] = cell.sort;
      } else if (cell.display !== undefined && cell.display !== null && cell.display !== "") {
        out[safeKey] = cell.display;
      } else {
        out[safeKey] = null;
      }
      continue;
    }
    // 表示テーブル外（schema 由来の非表示列）: computeRowValues で値が生成されないので、
    // entry.data から直接拾う。`WHERE 非表示列 IS NOT NULL` などを効かせるための経路。
    if (col.path) {
      const raw = entry.data?.[col.path];
      if (raw === undefined || raw === null || raw === "") {
        out[safeKey] = null;
      } else if (Array.isArray(raw)) {
        // 配列値（checkboxes の selected value 配列等）は表示と同じ「,」連結に正規化
        const joined = raw.filter((v) => v !== null && v !== undefined && v !== "").join(",");
        out[safeKey] = joined === "" ? null : joined;
      } else {
        out[safeKey] = raw;
      }
    }
  }
  // entry の固定列（メタ列の getValue で既に埋まっているはずだが防御的に）
  // `createdAt`（作成日時）/ `modifiedAt`（最終更新日時）は検索可。
  // `createdBy` / `modifiedBy` / `deletedAt` / `deletedBy` は検索対象外なので row dict にも出さない。
  if (out["id"] === undefined) out["id"] = entry.id || "";
  if (out["createdAt"] === undefined) {
    // datetime メタ列は canonical 文字列 `YYYY/MM/DD HH:mm:ss.SSS`（混在する ISO / Date / 数値を吸収）
    out["createdAt"] = formatCanonical(entry.createdAt, "datetime") ?? null;
  }
  if (out["modifiedAt"] === undefined) {
    out["modifiedAt"] = formatCanonical(entry.modifiedAt, "datetime") ?? null;
  }
  return out;
}

/**
 * strict モード評価に渡す AlaSQL 行から、検索非対象のメタ列キー
 * （EXCLUDED_META_COLUMN_KEYS = createdBy / modifiedBy / deletedAt / deletedBy）を取り除く。
 * entriesToAlaSqlRows / entriesToViewTableRows はこれらを行 dict に含むため、WHERE で
 * 参照されないよう評価直前に落とし、簡易モード（searchColumns ベース）とアクセス範囲を揃える。
 * 該当キーを持たない行はクローンせずそのまま返す（破壊的変更を避ける）。
 *
 * @param {Array<object>} rows AlaSQL 評価用の行 dict 配列
 * @returns {Array<object>} 非対象メタ列を除いた行配列
 */
export function stripNonSearchableMetaKeys(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    let clone = null;
    for (const key of EXCLUDED_META_COLUMN_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        if (!clone) clone = { ...row };
        delete clone[key];
      }
    }
    return clone || row;
  });
}
