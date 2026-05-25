/**
 * 閲覧者がカードに一時的にかける「期間フィルタ」用のプリセットと適用ロジック。
 *
 * dateFilter の形: { column: string, kind: "date"|"time", from: string|null, to: string|null }
 *   kind === "date": from / to は "YYYY-MM-DD"（ローカル日付）。null は無制限。
 *                    to は「その日いっぱい」を含む（内部で +1 日して上限未満で判定）。
 *   kind === "time": from / to は "HH:mm"（または "HH:mm:ss"）。null は無制限。
 *                    to は「その分いっぱい」を含む（内部で +1 分して上限未満で判定）。
 */

import { parseTimeStringToMsSinceMidnight, pad2 } from "../../../utils/dateTime.js";
import { MS_PER_DAY as DAY_MS } from "../../../core/constants.js";

const MINUTE_MS = 60 * 1000;
// canonical な時刻文字列（"HH:mm" / "HH:mm:ss"）。先頭に日付成分が付いていればマッチしない。
const TIME_ONLY_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;

/** Date → "YYYY-MM-DD"（ローカル日付）。 */
export function toYmd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfTodayMs(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * プリセット一覧。range(now) は { from, to } を返す（now 省略時は現在時刻）。
 */
export function datePresets() {
  return [
    {
      key: "last7",
      label: "直近7日",
      range: (now = Date.now()) => ({ from: toYmd(new Date(startOfTodayMs(now) - 6 * DAY_MS)), to: toYmd(new Date(now)) }),
    },
    {
      key: "last30",
      label: "直近30日",
      range: (now = Date.now()) => ({ from: toYmd(new Date(startOfTodayMs(now) - 29 * DAY_MS)), to: toYmd(new Date(now)) }),
    },
    {
      key: "last90",
      label: "直近90日",
      range: (now = Date.now()) => ({ from: toYmd(new Date(startOfTodayMs(now) - 89 * DAY_MS)), to: toYmd(new Date(now)) }),
    },
    {
      key: "thisMonth",
      label: "今月",
      range: (now = Date.now()) => {
        const d = new Date(now);
        return { from: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`, to: toYmd(d) };
      },
    },
  ];
}

function parseBoundMs(ymdLike, { endExclusive = false } = {}) {
  if (ymdLike === null || ymdLike === undefined || ymdLike === "") return null;
  const t = new Date(ymdLike).getTime();
  if (!Number.isFinite(t)) return null;
  return endExclusive ? t + DAY_MS : t;
}

function rowDateMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * dateFilter に従って rows を絞り込む。
 * dateFilter が falsy / column 未指定 / from・to ともに空なら rows をそのまま返す。
 * 対象列の値が日付として解釈できない行は、フィルタが有効なときは除外する。
 */
export function applyDateFilter(rows, dateFilter) {
  if (!Array.isArray(rows)) return rows;
  if (!dateFilter || !dateFilter.column) return rows;
  const fromMs = parseBoundMs(dateFilter.from);
  const toMs = parseBoundMs(dateFilter.to, { endExclusive: true });
  if (fromMs === null && toMs === null) return rows;
  const col = dateFilter.column;
  return rows.filter((r) => {
    const t = rowDateMs(r ? r[col] : null);
    if (t === null) return false;
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t >= toMs) return false;
    return true;
  });
}

/**
 * 時刻列向けのプリセット一覧。range() は { from, to }（"HH:mm"）を返す。
 * 値は調整しやすいよう素朴に並べてある。
 */
export function timePresets() {
  return [
    { key: "morning", label: "午前 (〜12:00)", range: () => ({ from: "00:00", to: "11:59" }) },
    { key: "afternoon", label: "午後 (12:00〜)", range: () => ({ from: "12:00", to: "23:59" }) },
    { key: "businessHours", label: "9:00〜18:00", range: () => ({ from: "09:00", to: "18:00" }) },
  ];
}

function parseTimeBoundMs(timeLike, { endExclusive = false } = {}) {
  if (timeLike === null || timeLike === undefined || timeLike === "") return null;
  const ms = parseTimeStringToMsSinceMidnight(String(timeLike).trim());
  if (ms === null) return null;
  return endExclusive ? ms + MINUTE_MS : ms;
}

/**
 * timeFilter に従って rows を絞り込む（"その日の時刻" 単位での範囲指定）。
 * timeFilter が falsy / column 未指定 / from・to ともに空なら rows をそのまま返す。
 * 対象列の値が時刻として解釈できない行は、フィルタが有効なときは除外する。
 */
export function applyTimeFilter(rows, timeFilter) {
  if (!Array.isArray(rows)) return rows;
  if (!timeFilter || !timeFilter.column) return rows;
  const fromMs = parseTimeBoundMs(timeFilter.from);
  const toMs = parseTimeBoundMs(timeFilter.to, { endExclusive: true });
  if (fromMs === null && toMs === null) return rows;
  const col = timeFilter.column;
  return rows.filter((r) => {
    const v = r ? r[col] : null;
    const t = typeof v === "string" ? parseTimeStringToMsSinceMidnight(v.trim()) : null;
    if (t === null) return false;
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t >= toMs) return false;
    return true;
  });
}

/**
 * rows から column の最初の非空値を 1 つ取り、それが時刻のみ文字列なら "time"、
 * それ以外（値なし含む）は "date" を返す純関数。期間フィルタの UI / 適用ロジック分岐用。
 */
export function inferRangeKind(rows, column) {
  if (!column || !Array.isArray(rows)) return "date";
  for (const r of rows) {
    if (!r) continue;
    const v = r[column];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string" && TIME_ONLY_RE.test(v.trim())) return "time";
    return "date";
  }
  return "date";
}
