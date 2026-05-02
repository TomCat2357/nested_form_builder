/**
 * IndexedDB の records (entry) を集計するための純関数群。
 * - 全関数はサイドエフェクトなし。
 * - entry の値は entry.data[path]、日付/時刻は entry.dataUnixMs[path] で参照する。
 * - records は配列を想定。空・null・undefined は許容して結果が「空」になるだけ。
 */

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

const toComparable = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v;
  return v;
};

const isLive = (entry) => entry && !entry.deletedAtUnixMs;

const valueAt = (entry, path) => {
  if (!entry || !entry.data) return undefined;
  return entry.data[path];
};

const numericAt = (entry, path) => {
  const raw = valueAt(entry, path);
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
};

const unixMsAt = (entry, path) => {
  if (!entry) return null;
  const ms = entry.dataUnixMs?.[path];
  if (Number.isFinite(ms) && ms > 0) return ms;
  const raw = valueAt(entry, path);
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string" && raw) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * カテゴリ集計。値が配列なら各要素を別カウント (checkboxes 想定)。
 * 戻り値: [{ key, count }] (count 降順)
 */
export function groupBy(records, path, { includeNull = false } = {}) {
  const counts = new Map();
  (records || []).forEach((entry) => {
    if (!isLive(entry)) return;
    const value = toComparable(valueAt(entry, path));
    const bump = (k) => counts.set(k, (counts.get(k) || 0) + 1);
    if (Array.isArray(value)) {
      if (value.length === 0) {
        if (includeNull) bump("(未回答)");
      } else {
        value.forEach((v) => bump(v === null || v === undefined || v === "" ? "(空)" : String(v)));
      }
    } else if (value === null || value === undefined || value === "") {
      if (includeNull) bump("(未回答)");
    } else {
      bump(String(value));
    }
  });
  const out = [];
  counts.forEach((count, key) => {
    out.push({ key, count });
  });
  out.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function countLive(records) {
  return (records || []).reduce((acc, e) => acc + (isLive(e) ? 1 : 0), 0);
}

export function sumBy(records, path) {
  let sum = 0;
  (records || []).forEach((entry) => {
    if (!isLive(entry)) return;
    const n = numericAt(entry, path);
    if (n !== null) sum += n;
  });
  return sum;
}

export function meanBy(records, path) {
  let sum = 0;
  let count = 0;
  (records || []).forEach((entry) => {
    if (!isLive(entry)) return;
    const n = numericAt(entry, path);
    if (n !== null) {
      sum += n;
      count += 1;
    }
  });
  return count > 0 ? sum / count : null;
}

const percentile = (sortedAscNumbers, p) => {
  if (!sortedAscNumbers || sortedAscNumbers.length === 0) return null;
  if (sortedAscNumbers.length === 1) return sortedAscNumbers[0];
  const rank = (p / 100) * (sortedAscNumbers.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAscNumbers[lo];
  const frac = rank - lo;
  return sortedAscNumbers[lo] + (sortedAscNumbers[hi] - sortedAscNumbers[lo]) * frac;
};

/**
 * 数値フィールドの記述統計。
 * 戻り値: { count, nullCount, min, max, mean, median, p25, p75, sum }
 */
export function describeNumeric(records, path) {
  const values = [];
  let nullCount = 0;
  (records || []).forEach((entry) => {
    if (!isLive(entry)) return;
    const n = numericAt(entry, path);
    if (n === null) nullCount += 1;
    else values.push(n);
  });
  values.sort((a, b) => a - b);
  if (values.length === 0) {
    return { count: 0, nullCount, min: null, max: null, mean: null, median: null, p25: null, p75: null, sum: 0 };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    nullCount,
    min: values[0],
    max: values[values.length - 1],
    mean: sum / values.length,
    median: percentile(values, 50),
    p25: percentile(values, 25),
    p75: percentile(values, 75),
    sum,
  };
}

/**
 * 行 × 列 のクロス集計。
 * @param valueAggregator: "count" | "sum" | "mean"
 * @param valuePath: count 以外で使用するフィールド
 * 戻り値: { rows: string[], cols: string[], cells: { [row]: { [col]: number } } }
 */
export function pivot(records, rowPath, colPath, { valueAggregator = "count", valuePath = null } = {}) {
  const rowSet = new Set();
  const colSet = new Set();
  const buckets = new Map(); // key = `${row}${col}` -> { sum, count }
  (records || []).forEach((entry) => {
    if (!isLive(entry)) return;
    const r = valueAt(entry, rowPath);
    const c = valueAt(entry, colPath);
    if (r === null || r === undefined || r === "" || c === null || c === undefined || c === "") return;
    const rKey = String(r);
    const cKey = String(c);
    rowSet.add(rKey);
    colSet.add(cKey);
    const bucketKey = `${rKey}${cKey}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { sum: 0, count: 0 };
      buckets.set(bucketKey, bucket);
    }
    if (valueAggregator === "count") {
      bucket.count += 1;
    } else if (valuePath) {
      const n = numericAt(entry, valuePath);
      if (n !== null) {
        bucket.sum += n;
        bucket.count += 1;
      }
    }
  });
  const rows = Array.from(rowSet).sort();
  const cols = Array.from(colSet).sort();
  const cells = {};
  rows.forEach((row) => {
    cells[row] = {};
    cols.forEach((col) => {
      const bucket = buckets.get(`${row}${col}`);
      if (!bucket) {
        cells[row][col] = null;
        return;
      }
      if (valueAggregator === "count") cells[row][col] = bucket.count;
      else if (valueAggregator === "sum") cells[row][col] = bucket.sum;
      else if (valueAggregator === "mean") cells[row][col] = bucket.count > 0 ? bucket.sum / bucket.count : null;
      else cells[row][col] = bucket.count;
    });
  });
  return { rows, cols, cells };
}

const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const formatBucketLabel = (date, granularity) => {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  if (granularity === "month") return `${y}-${m}`;
  if (granularity === "week") {
    const wd = date.getDay();
    const start = new Date(date);
    start.setDate(start.getDate() - wd);
    const sy = start.getFullYear();
    const sm = pad2(start.getMonth() + 1);
    const sd = pad2(start.getDate());
    return `${sy}-${sm}-${sd}`;
  }
  return `${y}-${m}-${d}`;
};

/**
 * 時系列バケット集計。
 * - granularity: "day" | "week" | "month"
 * - aggregator: "count" | "sum" | "mean"
 * - valuePath: aggregator !== "count" のときに参照する数値フィールド
 * 戻り値: [{ bucket, value, count }] (bucket 昇順)
 */
export function bucketByDate(records, dateFieldPath, {
  granularity = "day",
  aggregator = "count",
  valuePath = null,
} = {}) {
  const buckets = new Map();
  (records || []).forEach((entry) => {
    if (!isLive(entry)) return;
    const ms = unixMsAt(entry, dateFieldPath);
    if (!Number.isFinite(ms) || ms <= 0) return;
    const label = formatBucketLabel(new Date(ms), granularity);
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = { sum: 0, count: 0 };
      buckets.set(label, bucket);
    }
    if (aggregator === "count") {
      bucket.count += 1;
    } else if (valuePath) {
      const n = numericAt(entry, valuePath);
      if (n !== null) {
        bucket.sum += n;
        bucket.count += 1;
      }
    } else {
      bucket.count += 1;
    }
  });
  const out = [];
  buckets.forEach((bucket, key) => {
    let value;
    if (aggregator === "count") value = bucket.count;
    else if (aggregator === "sum") value = bucket.sum;
    else if (aggregator === "mean") value = bucket.count > 0 ? bucket.sum / bucket.count : null;
    else value = bucket.count;
    out.push({ bucket: key, value, count: bucket.count });
  });
  out.sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
  return out;
}

/**
 * 複数フォームの records を formId をキーにフラットなレコード配列に変換する。
 * 各レコードに __formId と __formTitle を埋め込む。
 */
export function flattenForms(formsRecords) {
  const out = [];
  Object.entries(formsRecords || {}).forEach(([formId, payload]) => {
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const formTitle = payload?.__formTitle || "";
    entries.forEach((entry) => {
      if (!entry) return;
      out.push({ ...entry, __formId: formId, __formTitle: formTitle });
    });
  });
  return out;
}

/** 公開: helpers として CustomCodeCell に渡すラッパ */
export const dashboardHelpers = {
  groupBy,
  sumBy,
  meanBy,
  countLive,
  describeNumeric,
  pivot,
  bucketByDate,
  flattenForms,
  isFiniteNumber,
  numericAt,
  unixMsAt,
  valueAt,
};
