/**
 * 和暦変換ユーティリティ。
 * registerNfbUdfs.js の DATETIME2ERA / DATE2ERA / ERA2DATETIME / ERA2DATE UDF と
 * TIME_FORMAT UDF (`gge年MM月DD日` 書式トークン) で共有する、純関数群と元号テーブル。
 *
 * `ERAS` の `year/month/day` は `start` から派生した同一値（呼び出し側の都合で
 * Date オブジェクト or 数値どちらでも使えるよう両方持つ）。
 */

// 改元日以降は新元号として認識する。降順で評価。
export const ERAS = [
  { name: "令和", short: "R", start: new Date(2019, 4, 1),   year: 2019, month: 5,  day: 1  },
  { name: "平成", short: "H", start: new Date(1989, 0, 8),   year: 1989, month: 1,  day: 8  },
  { name: "昭和", short: "S", start: new Date(1926, 11, 25), year: 1926, month: 12, day: 25 },
  { name: "大正", short: "T", start: new Date(1912, 6, 30),  year: 1912, month: 7,  day: 30 },
  { name: "明治", short: "M", start: new Date(1868, 0, 25),  year: 1868, month: 1,  day: 25 },
];

/**
 * `{ year, month, day }` からその日付の元号と元号年（1〜）を返す。
 * 改元前は `{ name: "", year: <西暦そのまま> }`。
 * TIME_FORMAT UDF の書式トークン展開で使用。
 */
export function resolveEraFromParts(dateParts) {
  for (let i = 0; i < ERAS.length; i++) {
    const e = ERAS[i];
    const sameOrAfter = dateParts.year > e.year
      || (dateParts.year === e.year && dateParts.month > e.month)
      || (dateParts.year === e.year && dateParts.month === e.month && dateParts.day >= e.day);
    if (sameOrAfter) return { name: e.name, year: dateParts.year - e.year + 1 };
  }
  return { name: "", year: dateParts.year };
}

/**
 * 和暦文字列 → Date。
 *
 * 対応入力:
 * - 漢字フル: `令和7年5月6日`、`令和元年5月1日`、`令和7年5月6日 14:35:48`
 * - 略号 + 区切り (. / -): `R7.5.6`、`H元.1.8`、`S40-1-1`、`R7.5.6 14:35:48`
 * - コンパクト 6 桁: `R070506`
 *
 * 改元前 / 不正値は null。
 */
export function parseEra(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (!s) return null;

  let eraKey, yPart, mo, da, hh = 0, mm = 0, ss = 0;
  let m;

  // パターン1: 漢字フル表記
  m = s.match(
    /^(令和|平成|昭和|大正|明治)(元|\d+)年(\d+)月(\d+)日(?:\s+(\d+):(\d+)(?::(\d+))?)?$/
  );
  if (m) {
    eraKey = m[1]; yPart = m[2]; mo = m[3]; da = m[4];
    hh = m[5] || 0; mm = m[6] || 0; ss = m[7] || 0;
  }

  // パターン2: アルファベット略号 + 区切り
  if (!m) {
    m = s.match(
      /^([RHSTMrhstm])(元|\d+)[.\-/](\d+)[.\-/](\d+)(?:\s+(\d+):(\d+)(?::(\d+))?)?$/
    );
    if (m) {
      eraKey = m[1].toUpperCase(); yPart = m[2]; mo = m[3]; da = m[4];
      hh = m[5] || 0; mm = m[6] || 0; ss = m[7] || 0;
    }
  }

  // パターン3: コンパクト 6 桁
  if (!m) {
    const c = s.match(/^([RHSTMrhstm])(\d{2})(\d{2})(\d{2})$/);
    if (c) {
      eraKey = c[1].toUpperCase();
      yPart = String(parseInt(c[2], 10));
      mo = c[3]; da = c[4];
      m = c;
    }
  }

  if (!m) return null;

  const era = ERAS.find((e) => e.name === eraKey || e.short === eraKey);
  if (!era) return null;

  const eraYear = yPart === "元" ? 1 : parseInt(yPart, 10);
  if (!Number.isInteger(eraYear) || eraYear < 1) return null;

  const year = era.start.getFullYear() + eraYear - 1;
  const d = new Date(
    year,
    parseInt(mo, 10) - 1,
    parseInt(da, 10),
    parseInt(hh, 10),
    parseInt(mm, 10),
    parseInt(ss, 10)
  );

  if (d < era.start) return null;
  const idx = ERAS.indexOf(era);
  if (idx > 0 && d >= ERAS[idx - 1].start) return null;

  return d;
}

// ============================================================================
// DATE2ERA / DATETIME2ERATIME / ERA2DATE / ERATIME2DATETIME 用（仕様: ゼロ
// パディングなしの和暦、令和1年→令和元年）。GAS twin は expressionFunctions.gs の
// nfbFormatEraNonPadded_ / nfbParseEraFlexible_。
// ============================================================================

// year/month/day だけを見る大小比較（時刻成分は無視）。改元境界判定に使う。
const dateGte_ = (a, b) =>
  a.year > b.year
  || (a.year === b.year && a.month > b.month)
  || (a.year === b.year && a.month === b.month && a.day >= b.day);

const eraStartParts_ = (e) => ({ year: e.start.getFullYear(), month: e.start.getMonth() + 1, day: e.start.getDate() });

/**
 * 西暦パーツ `{year, month, day, hour?, minute?, second?}` → ゼロパディングなし和暦文字列。
 * `令和1年` は `令和元年` と表示。明治より前 / 不正は null。
 * opts:
 *   withTime  — `時/分/秒`（または `H:m:s`）を末尾に付ける（時刻が無ければ 0 扱い）
 *   timeKanji — 時刻区切りを `時分秒` にする（false なら `:`）
 *   padTime   — 時刻成分を 2 桁ゼロパディング
 */
export function formatEraNonPadded(dateParts, opts = {}) {
  if (!dateParts) return null;
  const { year, month, day } = dateParts;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const era = ERAS.find((e) => dateGte_(dateParts, eraStartParts_(e)));
  if (!era) return null;
  const eraYearNum = year - era.start.getFullYear() + 1;
  const eraYearStr = eraYearNum === 1 ? "元" : String(eraYearNum);
  let base = `${era.name}${eraYearStr}年${month}月${day}日`;
  if (opts.withTime) {
    const hh = Number.isFinite(dateParts.hour) ? dateParts.hour : 0;
    const mi = Number.isFinite(dateParts.minute) ? dateParts.minute : 0;
    const ss = Number.isFinite(dateParts.second) ? dateParts.second : 0;
    const f = opts.padTime ? (n) => String(n).padStart(2, "0") : (n) => String(n);
    base += opts.timeKanji ? ` ${f(hh)}時${f(mi)}分${f(ss)}秒` : ` ${f(hh)}:${f(mi)}:${f(ss)}`;
  }
  return base;
}

const ERA_TIME_KANJI_RE_ = /\s*(\d{1,2})時(?:(\d{1,2})分(?:(\d{1,2})秒)?)?$/;
const ERA_TIME_COLON_RE_ = /\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

/**
 * 和暦文字列 → 西暦パーツ `{year, month, day, hour, minute, second}`（不正は null）。
 * parseEra より緩く、月日の省略と漢字時刻（`13時` / `10時22分00秒`）・部分時刻に対応。
 *
 * 対応入力例:
 *   令和7年5月6日 / 令和元年5月1日 / 令和元年02月4日 / 令和2年4月 / 令和2年
 *   令和2年4月15日 10時22分00秒 / 令和元年02月4日 13時 / 令和7年5月6日 14:35:48
 *   R7.5.6 / H元.1.8 / S40-1-1 / R070506 / R7.5.6 14:35:48
 * 月日省略時は 1、時刻省略時は 0。
 * `parseEra` と違い改元境界の検証はしない（`令和元年02月4日` のように改元前の月日でも
 * `元号年 → 西暦年` の単純変換で受ける ＝ ユーザーが書いた「令和元年」は西暦 2019 の意）。
 * 元号年 < 1 / 月日が範囲外 / 元号名不明 は null。
 */
export function parseEraFlexible(text) {
  if (text === null || text === undefined) return null;
  let s = String(text).trim();
  if (!s) return null;

  let hh = 0;
  let mi = 0;
  let ss = 0;
  let tm = s.match(ERA_TIME_KANJI_RE_);
  if (tm) {
    hh = parseInt(tm[1], 10);
    mi = tm[2] ? parseInt(tm[2], 10) : 0;
    ss = tm[3] ? parseInt(tm[3], 10) : 0;
    s = s.slice(0, tm.index).trim();
  } else {
    tm = s.match(ERA_TIME_COLON_RE_);
    if (tm) {
      hh = parseInt(tm[1], 10);
      mi = parseInt(tm[2], 10);
      ss = tm[3] ? parseInt(tm[3], 10) : 0;
      s = s.slice(0, tm.index).trim();
    }
  }
  if (hh < 0 || hh > 23 || mi < 0 || mi > 59 || ss < 0 || ss > 59) return null;

  let eraKey;
  let eraYearPart;
  let mo = 1;
  let da = 1;
  let d = s.match(/^(令和|平成|昭和|大正|明治)(元|\d{1,2})年(?:(\d{1,2})月(?:(\d{1,2})日)?)?$/);
  if (d) {
    eraKey = d[1];
    eraYearPart = d[2];
    mo = d[3] ? parseInt(d[3], 10) : 1;
    da = d[4] ? parseInt(d[4], 10) : 1;
  }
  if (!d) {
    d = s.match(/^([RHSTMrhstm])(元|\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{1,2}))?$/);
    if (d) {
      eraKey = d[1].toUpperCase();
      eraYearPart = d[2];
      mo = parseInt(d[3], 10);
      da = d[4] ? parseInt(d[4], 10) : 1;
    }
  }
  if (!d) {
    d = s.match(/^([RHSTMrhstm])(\d{2})(\d{2})(\d{2})$/);
    if (d) {
      eraKey = d[1].toUpperCase();
      eraYearPart = String(parseInt(d[2], 10));
      mo = parseInt(d[3], 10);
      da = parseInt(d[4], 10);
    }
  }
  if (!d) return null;

  const era = ERAS.find((e) => e.name === eraKey || e.short === eraKey);
  if (!era) return null;
  const eraYear = eraYearPart === "元" ? 1 : parseInt(eraYearPart, 10);
  if (!Number.isInteger(eraYear) || eraYear < 1) return null;
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;

  const year = era.start.getFullYear() + eraYear - 1;
  return { year, month: mo, day: da, hour: hh, minute: mi, second: ss };
}
