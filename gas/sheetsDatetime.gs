function Sheets_isValidDate_(date) {
  return date instanceof Date && !isNaN(date.getTime());
}

// タイムゾーン指定子 ("Z" / "+09:00" / "+0900" / "-05:00") → UTC からのオフセット ms。不正は null。
function Sheets_parseTzOffsetMs_(token) {
  if (typeof token !== "string") return null;
  var s = token.replace(/^\s+|\s+$/g, "");
  if (s === "Z" || s === "z") return 0;
  var m = s.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  var sign = m[1] === "-" ? -1 : 1;
  var hh = parseInt(m[2], 10);
  var mm = parseInt(m[3], 10);
  if (hh > 23 || mm > 59) return null;
  return sign * (hh * 60 + mm) * 60000;
}

function Sheets_normalizeNumericToUnixMs_(value, allowSerialNumber) {
  if (typeof value !== "number" || !isFinite(value)) return null;
  var abs = Math.abs(value);
  if (abs >= 100000000000) return value;
  if (abs >= 1000000000) return value * 1000;
  if (allowSerialNumber) return NFB_SHEETS_EPOCH_MS + value * NFB_MS_PER_DAY;
  return null;
}

// 固定メタ列 (createdAt / modifiedAt / deletedAt) 専用の厳密パーサ。
// abs >= 1e11 のみ Unix ms として通し、それ未満は null を返す。
// Sheets_normalizeNumericToUnixMs_ にある Unix 秒(×1000) や Excel シリアル値の
// 自動再解釈をしないため、手動編集で桁を削った値が遠未来日付として復元されない。
function Sheets_toStrictUnixMs_(value) {
  if (value === null || value === undefined) return null;
  if (Sheets_isValidDate_(value)) {
    var ms = value.getTime();
    return isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") {
    if (!isFinite(value)) return null;
    return Math.abs(value) >= 100000000000 ? value : null;
  }
  if (typeof value === "string") {
    var str = value.trim();
    if (!str) return null;
    if (/^[-+]?\d+(?:\.\d+)?$/.test(str)) {
      var n = parseFloat(str);
      if (!isFinite(n)) return null;
      return Math.abs(n) >= 100000000000 ? n : null;
    }
    // 文字列日付はシリアル値解釈を許可しない（数値経路は上で処理済み）
    var d = Sheets_parseDateLikeToJstDate_(str, false);
    if (!d) return null;
    var dms = d.getTime();
    return isFinite(dms) && Math.abs(dms) >= 100000000000 ? dms : null;
  }
  return null;
}

function Sheets_parseNumericToDate_(value, allowSerialNumber) {
  var unixMs = Sheets_normalizeNumericToUnixMs_(value, allowSerialNumber);
  if (!Number.isFinite(unixMs)) return null;
  var d = new Date(unixMs);
  return Sheets_isValidDate_(d) ? d : null;
}

function Sheets_parseDateLikeToJstDate_(value, allowSerialNumber) {
  if (value === null || value === undefined) return null;
  if (Sheets_isValidDate_(value)) return value;

  if (allowSerialNumber) {
    if (typeof value === "number" && isFinite(value)) {
      return Sheets_parseNumericToDate_(value, true);
    }
    if (typeof value === "string") {
      var numeric = value.trim();
      if (/^[-+]?\d+(?:\.\d+)?$/.test(numeric)) {
        var numericValue = parseFloat(numeric);
        if (isFinite(numericValue)) {
          return Sheets_parseNumericToDate_(numericValue, true);
        }
      }
    }
  }

  if (typeof value !== "string") return null;
  var str = value.trim();
  if (!str) return null;

  // ISO 8601 で TZ 指定子（Z / ±HH:MM）付き → その時差を考慮して瞬間を確定
  var isoTz = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s_]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?\s*(Z|z|[+-]\d{2}:?\d{2})$/);
  if (isoTz) {
    var offMs = Sheets_parseTzOffsetMs_(isoTz[8]);
    if (offMs === null) return null;
    var iy = parseInt(isoTz[1], 10), imo = parseInt(isoTz[2], 10), id_ = parseInt(isoTz[3], 10);
    var ih = parseInt(isoTz[4], 10), imi = parseInt(isoTz[5], 10), isec = isoTz[6] ? parseInt(isoTz[6], 10) : 0;
    var ims = isoTz[7] ? parseInt((isoTz[7] + "000").slice(0, 3), 10) : 0;
    if (imo < 1 || imo > 12 || id_ < 1 || id_ > 31 || ih > 23 || imi > 59 || isec > 59) return null;
    var isoDate = new Date(Date.UTC(iy, imo - 1, id_, ih, imi, isec, ims) - offMs);
    return Sheets_isValidDate_(isoDate) ? isoDate : null;
  }

  // YYYY-MM-DD or YYYY/MM/DD + HH:mm[:ss[.SSS]]（オフセット無し → JST 壁時計。区切りは `_` / 半角スペース / `T` / `/`）
  var dateTimeMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\/\s_]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?)$/);
  if (dateTimeMatch) {
    var parts = dateTimeMatch;
    var year = parseInt(parts[1], 10);
    var month = parseInt(parts[2], 10);
    var day = parseInt(parts[3], 10);
    var hour = parseInt(parts[4], 10);
    var minute = parseInt(parts[5], 10);
    var second = parts[6] ? parseInt(parts[6], 10) : 0;
    var millisecond = parts[7] ? parseInt((parts[7] + "000").slice(0, 3), 10) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    var dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - NFB_JST_OFFSET_MS);
    return Sheets_isValidDate_(dt) ? dt : null;
  }

  // YYYY-MM-DD / YYYY/MM/DD
  var dateOnlyMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (dateOnlyMatch) {
    var d = new Date(Date.UTC(
      parseInt(dateOnlyMatch[1], 10),
      parseInt(dateOnlyMatch[2], 10) - 1,
      parseInt(dateOnlyMatch[3], 10),
      0,
      0,
      0,
      0
    ) - NFB_JST_OFFSET_MS);
    return Sheets_isValidDate_(d) ? d : null;
  }

  // HH:mm[:ss] を基準日(1899-12-30)のJSTで扱う
  var timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnlyMatch) {
    var t = new Date(Date.UTC(
      1899,
      11,
      30,
      parseInt(timeOnlyMatch[1], 10),
      parseInt(timeOnlyMatch[2], 10),
      timeOnlyMatch[3] ? parseInt(timeOnlyMatch[3], 10) : 0,
      0
    ) - NFB_JST_OFFSET_MS);
    return Sheets_isValidDate_(t) ? t : null;
  }

  return null;
}

function Sheets_dateToSerial_(date) {
  if (!Sheets_isValidDate_(date)) return null;
  return date.getTime();
}

function Sheets_toUnixMs_(value, allowSerialNumber) {
  var d = Sheets_parseDateLikeToJstDate_(value, allowSerialNumber);
  return d ? d.getTime() : null;
}

// ============================================================================
// § スプレッドシート用「数値日時セル」変換
//   アプリ内部 / JSON / キャッシュは canonical 文字列のままだが、シートに書き込む
//   date / time / 日時セルは Date オブジェクト（= 数値の日時シリアル値）にする。
//   GAS のスクリプトタイムゾーンは Asia/Tokyo (= NFB_TZ) なので、ローカル時刻として
//   構築すれば setValues 後に壁時計どおりのシリアル値になり、getValues で同じ Date
//   が返る（= Sheets_sheetDateCellToCanonical_ で canonical 文字列に往復できる）。
// ============================================================================

// Unix ms → シート用 Date。非数値 / 不正値は null。
function Sheets_unixMsToSheetDate_(unixMs) {
  if (typeof unixMs !== "number" || !isFinite(unixMs)) return null;
  var d = new Date(unixMs);
  return isNaN(d.getTime()) ? null : d;
}

// canonical 文字列 ("YYYY/MM/DD" / "HH:mm:ss.SSS" / "YYYY/MM/DD HH:mm:ss.SSS") を
// シート用 Date に変換する。kind ∈ {"date","datetime","time"}。旧形式(ハイフン/`_`)・ms 省略形も許容。不正値は null。
function Sheets_canonicalToSheetDate_(canonical, kind) {
  if (typeof canonical !== "string") return null;
  var s = canonical.replace(/^\s+|\s+$/g, "");
  if (!s) return null;
  if (kind === "time") {
    var tm = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?$/);
    if (!tm) return null;
    var hh = parseInt(tm[1], 10), mi = parseInt(tm[2], 10), ss = tm[3] ? parseInt(tm[3], 10) : 0;
    var ms = tm[4] ? parseInt((tm[4] + "000").substring(0, 3), 10) : 0;
    if (hh > 23 || mi > 59 || ss > 59) return null;
    // Sheets の時刻シリアルの基準日 1899-12-30 をローカル(JST)で構築
    return new Date(1899, 11, 30, hh, mi, ss, ms);
  }
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T \s_](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?$/);
  if (!m) return null;
  var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  var h = m[4] ? parseInt(m[4], 10) : 0, mn = m[5] ? parseInt(m[5], 10) : 0, sc = m[6] ? parseInt(m[6], 10) : 0;
  var msd = m[7] ? parseInt((m[7] + "000").substring(0, 3), 10) : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mn > 59 || sc > 59) return null;
  return new Date(y, mo - 1, d, h, mn, sc, msd);
}

// シート上の数値日時セル (Date) を canonical 文字列に正規化する。
// 基準日 1899-12-30 の Date は "time"、真夜中ちょうどなら "date"、それ以外は "datetime"。
// canonical 化は nfbDt_formatCanonical_（expressionEvaluator.gs → NfbAlasqlRuntime.formatCanonical）に委譲。
function Sheets_sheetDateCellToCanonical_(date) {
  if (!Sheets_isValidDate_(date)) return date;
  var kind;
  if (date.getFullYear() === 1899 && date.getMonth() === 11 && date.getDate() === 30) {
    kind = "time";
  } else if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0) {
    kind = "date";
  } else {
    kind = "datetime";
  }
  var canonical = nfbDt_formatCanonical_(date, kind);
  return (canonical === null || canonical === undefined) ? date : canonical;
}

// ============================================================================
// § JST 文字列ストレージ形式（メタ日時）
//   `YYYY/MM/DD HH:mm:ss.SSS` 固定（日付はスラッシュ、日付↔時刻の区切りは半角スペース。ms までゼロ埋め）。
//   スラッシュ+ゼロ埋めの固定幅で「辞書順 = 時系列順」が成立。createdAt / modifiedAt / deletedAt の
//   シート格納・JSON ワイヤ・JS 内部の唯一の表現。
//   パース時の区切りは `-`/`/` と `_` / 半角スペース / `T` を許容、ms 省略形（旧データ）も許容。
// ============================================================================

var NFB_JST_STORAGE_RE_ = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s_]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?$/;

/**
 * Date / Unix ms / 文字列 を JST ストレージ文字列 `YYYY/MM/DD HH:mm:ss.SSS` に変換。
 * 不正値は空文字列。
 */
function Sheets_formatJstString_(value) {
  if (value === null || value === undefined || value === "") return "";
  var unixMs = null;
  if (typeof value === "string") {
    var trimmed = value.replace(/^\s+|\s+$/g, "");
    if (!trimmed) return "";
    var d = Sheets_parseJstString_(trimmed);
    if (d) {
      unixMs = d.getTime();
    } else {
      // 旧データ救済: ISO や数値文字列など緩いフォーマットも許容
      unixMs = Sheets_toUnixMs_(trimmed, false);
    }
  } else if (typeof value === "number" && isFinite(value)) {
    unixMs = Sheets_normalizeNumericToUnixMs_(value, false);
  } else if (Sheets_isValidDate_(value)) {
    unixMs = value.getTime();
  } else {
    return "";
  }
  if (!isFinite(unixMs)) return "";
  return Utilities.formatDate(new Date(unixMs), NFB_TZ, "yyyy/MM/dd HH:mm:ss.SSS");
}

/**
 * JST ストレージ文字列 → Date オブジェクト。
 * 区切りは `-` / `/` どちらも許容。時刻省略時は 00:00:00。
 * 不正値は null。
 */
function Sheets_parseJstString_(str) {
  if (typeof str !== "string") return null;
  var trimmed = str.replace(/^\s+|\s+$/g, "");
  if (!trimmed) return null;
  var m = trimmed.match(NFB_JST_STORAGE_RE_);
  if (!m) return null;
  var year = parseInt(m[1], 10);
  var month = parseInt(m[2], 10);
  var day = parseInt(m[3], 10);
  var hour = m[4] ? parseInt(m[4], 10) : 0;
  var minute = m[5] ? parseInt(m[5], 10) : 0;
  var second = m[6] ? parseInt(m[6], 10) : 0;
  var ms = m[7] ? parseInt((m[7] + "000").substring(0, 3), 10) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  // JST 壁時計時刻として解釈
  var jstOffset = 9 * 60 * 60 * 1000;
  var utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms) - jstOffset;
  if (!isFinite(utcMs)) return null;
  return new Date(utcMs);
}

/**
 * JST 文字列 → Unix ms（移行期/レガシ呼び出し用シム）。
 */
function Sheets_jstStringToUnixMs_(str) {
  var d = Sheets_parseJstString_(str);
  return d ? d.getTime() : null;
}


// date / time 列のセルを canonical 文字列（"YYYY/MM/DD" / "HH:mm:ss.SSS"）にメモリ上で統一する。
// シート上は数値の日時シリアル値 (Date)。Excel シリアル数値 / ISO / ゆる文字列 / 既 canonical も吸収する。
// 列型はフォームスキーマ由来の typeMap（key → "date" | "time" | "datetime"）のみで決定する
// （値スキャンによる推測は廃止）。canonical 化は nfbDt_formatCanonical_（expressionEvaluator.gs）に委譲。
function Sheets_applyTemporalFormatsToMemory_(columnPaths, values, dataRowCount, temporalTypeMap) {
  if (!dataRowCount) return;
  if (!temporalTypeMap || typeof temporalTypeMap !== "object") return;

  for (var j = 0; j < columnPaths.length; j++) {
    var colInfo = columnPaths[j];
    if (NFB_RESERVED_HEADER_KEYS[colInfo.key]) continue;

    var temporalType = temporalTypeMap[colInfo.key];
    if (temporalType !== "date" && temporalType !== "time" && temporalType !== "datetime") continue;

    var colIndex = colInfo.index;
    for (var i = 0; i < dataRowCount; i++) {
      var cell = values[i][colIndex];
      if (cell === null || cell === undefined || cell === "") continue;
      // シート上の数値日時セル（Excel シリアル値）は、この読み取り境界でのみ Date 化する。
      // canonical 化に使う nfbDt_formatCanonical_（= builder formatCanonical）は値による
      // シリアル推測をしないため、ここで明示的に Date へ変換してから渡す。
      if (typeof cell === "number" && isFinite(cell)) {
        var serialDate = Sheets_parseNumericToDate_(cell, true);
        if (serialDate) cell = serialDate;
      }
      var canonical = nfbDt_formatCanonical_(cell, temporalType);
      if (canonical !== null && canonical !== undefined) values[i][colIndex] = canonical;
    }
  }
}
