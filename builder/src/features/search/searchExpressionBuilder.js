/**
 * 検索クエリ → alasql 式 への変換 + 行データの構築。
 * useSearchPageState から呼ばれるエントリポイント。
 */
import { buildSimpleSearchExpression } from "./searchSimpleTranslate.js";
import { headerKeyToAlaSqlKey } from "../analytics/utils/headerToAlaSqlKey.js";
import { columnType } from "./searchTableValues.js";
import { formatCanonical } from "../../utils/dateTime.js";
import { NON_SEARCHABLE_META_KEYS } from "../../core/constants.js";

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
 * 検索対象から除外する固定メタ列。キー一覧は core/constants.js に一元化
 * （NON_SEARCHABLE_META_KEYS）。後方互換のため Set ラップを再 export する。
 */
export const EXCLUDED_META_COLUMN_KEYS = new Set(NON_SEARCHABLE_META_KEYS);

function isExcludedMetaColumn(col) {
  if (!col) return false;
  const key = col.key || "";
  return EXCLUDED_META_COLUMN_KEYS.has(key);
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
 * 検索クエリ文字列 → { expr, errors }。
 *
 * 簡易モード（プレフィックスなし）専用: searchSimpleTranslate（正規表現 / 複数値集合分解などを
 * alasql WHERE 式へ忠実に翻訳。トークナイザ/パーサは searchQueryEngine と共有）。
 * SQL モード（先頭 SELECT）は呼び出し側（useSearchPageState）が runSearchSelect へ振り分けるため
 * ここには来ない。
 *
 * 日付列は canonical 文字列として文字列比較する。
 * @param {string} query
 * @param {Array<{ key: string, path?: string, sourceType?: string, type?: string, searchable?: boolean }>} columns
 */
export function buildSearchExpression(query, columns) {
  return buildSimpleSearchExpression(query, columns);
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

