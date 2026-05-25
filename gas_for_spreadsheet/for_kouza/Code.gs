// =============================================================================
// スプレッドシートにバインドされた GAS。
// メニュー「カレンダー取込」→ モーダルで対象カレンダー・開始/終了年月を選択し、
// 件名に「講座」を含むイベントを抽出して、バインド SS の "Data" シートに upsert する。
//
// NFB (Nested Form Builder) のシート規約に準拠:
//   - ヘッダは行 1〜11 (深さ 11)
//   - データは行 12〜
//   - 固定メタ列: id / No. / createdAt / modifiedAt / deletedAt / createdBy / modifiedBy / deletedBy
//   - radio 「種類」は option ごとに 2 列展開 (種類|ヒグマ講座, 種類|出前講座)
// =============================================================================

// ----- 定数 ----------------------------------------------------------------
var SHEET_NAME = "Data";
var HEADER_DEPTH = 11;
var DATA_START_ROW = HEADER_DEPTH + 1;
var TZ = "Asia/Tokyo";
var FILTER_WORD = "講座";
var DEFAULT_CALENDAR_NAME = "環境共生担当課";

var DATETIME_FORMAT = "yyyy/mm/dd hh:mm:ss";
var DATE_FORMAT = "yyyy/mm/dd";
var TIME_FORMAT = "hh:mm";
var DUPLICATE_COLOR = "#FCE4E4";
var CHOICE_MARKER = "●";
var LOCK_WAIT_MS = 10000;

var TYPE_COL_HIGUMA = "種類|ヒグマ講座";
var TYPE_COL_DEMAE = "種類|出前講座";

// upsert 必須列。これらが Data シートに無ければ取り込みを停止する。
var REQUIRED_COLUMNS = [
  "id", "No.", "createdAt", "modifiedAt", "deletedAt", "createdBy", "modifiedBy", "deletedBy",
  "実施年月日", "開始時間", "終了時間",
  TYPE_COL_HIGUMA, TYPE_COL_DEMAE,
  "場所", "組織名等", "人数", "（参考）", "重複するレコードID"
];


// ----- onOpen / メニュー ---------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("カレンダー取込")
    .addItem("講座イベント取込…", "openImportDialog")
    .addToUi();
}


// ----- モーダル ダイアログ -------------------------------------------------
function openImportDialog() {
  var tpl = HtmlService.createTemplateFromFile("ImportDialog");
  tpl.calendars = listCalendarsForUi_();
  var defaults = defaultDateRange_();
  tpl.defaultStartDate = defaults.start; // 既定: 先月の 1 日
  tpl.defaultEndDate = defaults.end;     // 既定: 今月の末日
  var output = tpl.evaluate().setWidth(420).setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(output, "カレンダー取込");
}

function listCalendarsForUi_() {
  var cals = CalendarApp.getAllCalendars();
  var out = [];
  for (var i = 0; i < cals.length; i++) {
    var c = cals[i];
    out.push({
      id: c.getId(),
      name: c.getName(),
      isDefault: c.getName() === DEFAULT_CALENDAR_NAME
    });
  }
  // 既定カレンダーを先頭に、それ以降は名前順
  out.sort(function (a, b) {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  // 既定が存在しない場合、先頭に selected を付ける
  var hasDefault = false;
  for (var k = 0; k < out.length; k++) if (out[k].isDefault) { hasDefault = true; break; }
  if (!hasDefault && out.length > 0) out[0].isDefault = true;
  return out;
}

function defaultDateRange_() {
  var now = new Date();
  var y = now.getFullYear();
  var m = now.getMonth();
  var start = new Date(y, m - 1, 1);             // 先月の 1 日
  var end = new Date(y, m + 1, 0, 23, 59, 59);   // 今月の末日
  return {
    start: Utilities.formatDate(start, TZ, "yyyy-MM-dd"),
    end: Utilities.formatDate(end, TZ, "yyyy-MM-dd")
  };
}


// ----- メイン処理 ----------------------------------------------------------
function importCalendar(params) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return { ok: false, error: "他のユーザーが更新中です。少し待ってから再実行してください。" };
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);

    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return { ok: false, error: "「" + SHEET_NAME + "」シートが見つかりません。" };
    }

    var colMap = buildHeaderKeyMap_(sheet);
    var missing = findMissingColumns_(colMap, REQUIRED_COLUMNS);
    if (missing.length) {
      return { ok: false, error: "Data シートに必要な列が見つかりません: " + missing.join(", ") };
    }

    var events = fetchCalendarEvents_(params);
    var existing = readDataRows_(sheet, colMap);
    var upsertResult = upsertEvents_(sheet, colMap, existing, events);
    var dupResult = detectAndMarkOverlaps_(sheet, colMap);

    return {
      ok: true,
      added: upsertResult.added,
      updated: upsertResult.updated,
      duplicateRows: dupResult.duplicateRows
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    lock.releaseLock();
  }
}

function findMissingColumns_(colMap, keys) {
  var missing = [];
  for (var i = 0; i < keys.length; i++) {
    if (!colMap[keys[i]]) missing.push(keys[i]);
  }
  return missing;
}


// ----- カレンダー イベント抽出 (旧 handleExport の core を移植) -----------
function fetchCalendarEvents_(params) {
  if (!params || !params.calendarId) throw new Error("カレンダーが指定されていません。");
  if (!params.startDate || !params.endDate) throw new Error("期間が正しく指定されていません。");

  var s = String(params.startDate).split("-");
  var e = String(params.endDate).split("-");
  if (s.length !== 3 || e.length !== 3) throw new Error("期間の形式が正しくありません (YYYY-MM-DD)。");
  var startTime = new Date(Number(s[0]), Number(s[1]) - 1, Number(s[2]), 0, 0, 0);
  var endTime = new Date(Number(e[0]), Number(e[1]) - 1, Number(e[2]), 23, 59, 59);
  if (endTime < startTime) throw new Error("終了日は開始日以降を指定してください。");

  var cal = CalendarApp.getCalendarById(params.calendarId);
  if (!cal) throw new Error("カレンダーが見つかりません: " + params.calendarId);

  var raw = cal.getEvents(startTime, endTime);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var ev = raw[i];
    var title = ev.getTitle() || "";
    if (title.indexOf(FILTER_WORD) === -1) continue;
    out.push(parseEvent_(ev, title));
  }
  return out;
}

function parseEvent_(ev, title) {
  var desc = ev.getDescription() || "";
  var location = ev.getLocation() || "";
  var dateStr = Utilities.formatDate(ev.getStartTime(), TZ, "yyyy/MM/dd");

  var allDay = ev.isAllDayEvent();
  var startStr = allDay ? "終日" : Utilities.formatDate(ev.getStartTime(), TZ, "HH:mm");
  var endStr = allDay ? "-" : Utilities.formatDate(ev.getEndTime(), TZ, "HH:mm");

  // 「ヒグマ」と「出前」の両方が含まれる場合 (例:「ヒグマ出前講座」) は、
  // 「講座」に近い方だけを採用する。
  // - 各キーワードの「最後の出現位置」と「講座」の「最初の出現位置」との距離を比較
  // - 距離が小さい方を残し、もう一方は採用しない
  // - 「講座」が見つからない場合は両方を採用 (保険)
  // どちらも含まれなければ両方 false (種類欄にチェックは付かない)
  var hasHiguma = title.indexOf("ヒグマ") !== -1;
  var hasDemae = title.indexOf("出前") !== -1;
  if (hasHiguma && hasDemae) {
    var kouzaIdx = title.indexOf("講座");
    if (kouzaIdx !== -1) {
      var higumaLast = title.lastIndexOf("ヒグマ");
      var demaeLast = title.lastIndexOf("出前");
      // 「講座」より手前にある場合のみ距離を測る (講座までの間隔)
      var higumaDist = (higumaLast < kouzaIdx)
        ? (kouzaIdx - (higumaLast + "ヒグマ".length))
        : Infinity;
      var demaeDist = (demaeLast < kouzaIdx)
        ? (kouzaIdx - (demaeLast + "出前".length))
        : Infinity;
      if (higumaDist < demaeDist) {
        hasDemae = false;
      } else if (demaeDist < higumaDist) {
        hasHiguma = false;
      }
      // 同距離 (理論上稀) のときは両方残す
    }
  }

  var typeStr = "";
  if (hasHiguma && hasDemae) typeStr = "ヒグマ・出前講座";
  else if (hasHiguma) typeStr = "ヒグマ講座";
  else if (hasDemae) typeStr = "出前講座";

  // 人数抽出 (半角/全角)
  var peopleCount = "";
  var textToSearch = title + " \n " + desc;
  var m = textToSearch.match(/([0-9０-９]+)[\s　]?([名人])/);
  if (m) {
    peopleCount = m[1].replace(/[０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    });
  }

  // 組織名 (引き算方式)
  var orgName = title;
  orgName = orgName.replace(/【.*?】/g, "");
  orgName = orgName.replace(/(?:出前|ヒグマ|合同)?講座/g, "");
  orgName = orgName.replace(/[0-9０-９]+時[0-9０-９]+分(?:[～~\-][0-9０-９]+時[0-9０-９]+分)?/g, "");
  orgName = orgName.replace(/[0-9０-９]+[:：][0-9０-９]+(?:[～~\-][0-9０-９]+[:：][0-9０-９]+)?/g, "");
  orgName = orgName.replace(/[0-9０-９]+[\s　]?[名人]/g, "");
  var tokens = orgName.split(/[、。，．,:\s　@＠\(\)（）～~『』]+/);
  var filtered = [];
  for (var t = 0; t < tokens.length; t++) {
    if (tokens[t].length > 0 && tokens[t].indexOf("講座") === -1) filtered.push(tokens[t]);
  }
  orgName = filtered.join(" ");
  orgName = orgName.replace(/[、。，．,:\(\)（）～~『』@＠]/g, " ");
  orgName = orgName.replace(/[\s　]+/g, " ").replace(/^\s+|\s+$/g, "");

  // （参考）
  var timeRange;
  if (allDay) {
    timeRange = "終日";
  } else {
    var sFull = Utilities.formatDate(ev.getStartTime(), TZ, "yyyy/MM/dd HH:mm");
    var eFull = Utilities.formatDate(ev.getEndTime(), TZ, "yyyy/MM/dd HH:mm");
    timeRange = sFull + " 〜 " + eFull;
  }
  var refStr = "【件名】" + title +
    "\n【場所】" + location +
    "\n【日時】" + timeRange +
    "\n【説明】\n" + desc;

  return {
    date: dateStr,
    start: startStr,
    end: endStr,
    hasHiguma: hasHiguma,
    hasDemae: hasDemae,
    typeStr: typeStr,
    location: location,
    orgName: orgName,
    people: peopleCount,
    ref: refStr
  };
}

// ----- ヘッダ → 列番号マップ (NFB の 11 段ヘッダを動的に解決) ------------
function buildHeaderKeyMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) return {};
  var nRows = Math.min(HEADER_DEPTH, sheet.getMaxRows());
  if (nRows < 1) return {};
  var matrix = sheet.getRange(1, 1, nRows, lastCol).getValues();
  var map = {};
  for (var col = 0; col < lastCol; col++) {
    var segs = [];
    for (var row = 0; row < nRows; row++) {
      var raw = matrix[row][col];
      var cell = (raw == null) ? "" : String(raw).replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "");
      if (!cell) break;
      segs.push(cell);
    }
    if (segs.length) {
      var key = segs.join("|");
      // 先勝ち (同じヘッダが 2 列あっても最初の列を使う)
      if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = col + 1;
    }
  }
  return map;
}


// ----- 既存データ読み込み --------------------------------------------------
function readDataRows_(sheet, colMap) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < DATA_START_ROW) return [];
  var nRows = lastRow - DATA_START_ROW + 1;
  var values = sheet.getRange(DATA_START_ROW, 1, nRows, lastCol).getValues();
  var idC = colMap["id"];
  var dateC = colMap["実施年月日"];
  var startC = colMap["開始時間"];
  var endC = colMap["終了時間"];
  var higumaC = colMap[TYPE_COL_HIGUMA];
  var demaeC = colMap[TYPE_COL_DEMAE];
  var orgC = colMap["組織名等"];
  var noC = colMap["No."];

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[idC - 1] == null ? "" : row[idC - 1]).replace(/^\s+|\s+$/g, "");
    if (!id) continue;
    out.push({
      rowIndex: DATA_START_ROW + i,
      id: id,
      no: row[noC - 1],
      date: normalizeDate_(row[dateC - 1]),
      start: normalizeTime_(row[startC - 1]),
      end: normalizeTime_(row[endC - 1]),
      higumaMarked: isMarked_(row[higumaC - 1]),
      demaeMarked: isMarked_(row[demaeC - 1]),
      orgName: String(row[orgC - 1] == null ? "" : row[orgC - 1]).replace(/^\s+|\s+$/g, "")
    });
  }
  return out;
}


// ----- 正規化ヘルパ --------------------------------------------------------
function normalizeDate_(v) {
  if (v === "" || v == null) return "";
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy/MM/dd");
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    var mm = m[2].length < 2 ? "0" + m[2] : m[2];
    var dd = m[3].length < 2 ? "0" + m[3] : m[3];
    return m[1] + "/" + mm + "/" + dd;
  }
  return s;
}

function normalizeTime_(v) {
  if (v === "" || v == null) return "";
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "HH:mm");
  var s = String(v).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    var hh = m[1].length < 2 ? "0" + m[1] : m[1];
    return hh + ":" + m[2];
  }
  return s;
}

// NFB の isChoiceMarkerValue 相当 (true|1|"1"|"●" + 任意の非空文字列)
function isMarked_(v) {
  if (v === true || v === 1 || v === "1") return true;
  if (typeof v === "string") {
    var t = v.replace(/^\s+|\s+$/g, "");
    return t.length > 0;
  }
  return false;
}


// ----- upsert --------------------------------------------------------------
function upsertEvents_(sheet, colMap, existing, events) {
  var now = new Date();
  var email = Session.getActiveUser().getEmail() || "";

  // 既存レコードを「完全一致キー」で索引化
  var keyToExisting = {};
  for (var i = 0; i < existing.length; i++) {
    var k = matchKeyFromRecord_(existing[i]);
    keyToExisting[k] = existing[i];
  }

  // No. の最大値
  var maxNo = 0;
  for (var j = 0; j < existing.length; j++) {
    var n = Number(existing[j].no);
    if (isFinite(n) && n > maxNo) maxNo = n;
  }

  var lastCol = sheet.getLastColumn();
  var added = 0;
  var updated = 0;

  for (var e = 0; e < events.length; e++) {
    var ev = events[e];
    var evKey = matchKeyFromEvent_(ev);
    var match = keyToExisting[evKey];

    if (match) {
      // 上書き
      var existingRow = sheet.getRange(match.rowIndex, 1, 1, lastCol).getValues()[0];
      applyEventToRow_(existingRow, ev, colMap);
      existingRow[colMap["modifiedAt"] - 1] = now;
      existingRow[colMap["modifiedBy"] - 1] = email;
      // ソフトデリート復活
      existingRow[colMap["deletedAt"] - 1] = "";
      existingRow[colMap["deletedBy"] - 1] = "";
      writeRow_(sheet, match.rowIndex, existingRow, colMap);
      updated++;
    } else {
      // 新規追加
      maxNo += 1;
      var newRow = new Array(lastCol);
      for (var nc = 0; nc < lastCol; nc++) newRow[nc] = "";
      newRow[colMap["id"] - 1] = generateRecordId_();
      newRow[colMap["No."] - 1] = maxNo;
      newRow[colMap["createdAt"] - 1] = now;
      newRow[colMap["modifiedAt"] - 1] = now;
      newRow[colMap["createdBy"] - 1] = email;
      newRow[colMap["modifiedBy"] - 1] = email;
      applyEventToRow_(newRow, ev, colMap);
      var insertRow = findFirstBlankRow_(sheet, colMap);
      writeRow_(sheet, insertRow, newRow, colMap);
      added++;
    }
  }

  return { added: added, updated: updated };
}

// 完全一致キー: 実施年月日 + 開始時間 + 終了時間 + (種類2列マーカー)
// 組織名は含めない (タイポ等で別レコード扱いされ重複登録される事故を避けるため)。
// セパレータ "|" は時刻と種類マーカー (1 桁) の境界事故を防ぐために必須。
function matchKeyFromRecord_(rec) {
  return [
    rec.date,
    rec.start,
    rec.end,
    rec.higumaMarked ? "1" : "0",
    rec.demaeMarked ? "1" : "0"
  ].join("|");
}

function matchKeyFromEvent_(ev) {
  return [
    ev.date,
    ev.start,
    ev.end,
    ev.hasHiguma ? "1" : "0",
    ev.hasDemae ? "1" : "0"
  ].join("|");
}

function applyEventToRow_(row, ev, colMap) {
  row[colMap["実施年月日"] - 1] = dateStringToValue_(ev.date);
  row[colMap["開始時間"] - 1] = timeStringToValue_(ev.start);
  row[colMap["終了時間"] - 1] = timeStringToValue_(ev.end);
  row[colMap[TYPE_COL_HIGUMA] - 1] = ev.hasHiguma ? CHOICE_MARKER : "";
  row[colMap[TYPE_COL_DEMAE] - 1] = ev.hasDemae ? CHOICE_MARKER : "";
  row[colMap["場所"] - 1] = neutralizeFormula_(ev.location || "");
  row[colMap["組織名等"] - 1] = neutralizeFormula_(ev.orgName || "");
  row[colMap["人数"] - 1] = (ev.people === "" || ev.people == null) ? "" : Number(ev.people);
  row[colMap["（参考）"] - 1] = neutralizeFormula_(ev.ref || "");
  // 「備考」は触らない (手書き保護)
  // 「重複するレコードID」は detectAndMarkOverlaps_ で再計算するため触らない
}

function dateStringToValue_(s) {
  if (!s) return "";
  var m = String(s).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0);
}

// 「終日」「-」のような非時刻文字列は文字列のまま返す。
// HH:mm 形式は Sheets エポック (1899-12-30) ベースの Date にして時刻シリアル値を作る。
function timeStringToValue_(s) {
  if (!s) return "";
  if (s === "終日" || s === "-") return s;
  var m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;
  return new Date(1899, 11, 30, Number(m[1]), Number(m[2]), 0);
}

// 先頭が =, +, -, @, TAB, CR なら数式インジェクション対策で ' を付ける
function neutralizeFormula_(s) {
  if (typeof s !== "string" || s.length === 0) return s;
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

function writeRow_(sheet, rowIndex, values, colMap) {
  ensureRow_(sheet, rowIndex);
  var lastCol = values.length;
  var range = sheet.getRange(rowIndex, 1, 1, lastCol);
  range.setValues([values]);

  var formats = range.getNumberFormats()[0];
  formats[colMap["createdAt"] - 1] = DATETIME_FORMAT;
  formats[colMap["modifiedAt"] - 1] = DATETIME_FORMAT;
  formats[colMap["deletedAt"] - 1] = DATETIME_FORMAT;
  formats[colMap["実施年月日"] - 1] = DATE_FORMAT;

  var startVal = values[colMap["開始時間"] - 1];
  var endVal = values[colMap["終了時間"] - 1];
  formats[colMap["開始時間"] - 1] = (startVal instanceof Date) ? TIME_FORMAT : "@";
  formats[colMap["終了時間"] - 1] = (endVal instanceof Date) ? TIME_FORMAT : "@";
  range.setNumberFormats([formats]);
}

function ensureRow_(sheet, rowIndex) {
  var max = sheet.getMaxRows();
  if (max < rowIndex) sheet.insertRowsAfter(max, rowIndex - max);
}

function findFirstBlankRow_(sheet, colMap) {
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return DATA_START_ROW;
  var idCol = colMap["id"];
  var nRows = lastRow - DATA_START_ROW + 1;
  var idValues = sheet.getRange(DATA_START_ROW, idCol, nRows, 1).getValues();
  for (var i = 0; i < idValues.length; i++) {
    var v = idValues[i][0];
    if (String(v == null ? "" : v).replace(/^\s+|\s+$/g, "") === "") {
      return DATA_START_ROW + i;
    }
  }
  return lastRow + 1;
}


// ----- 時刻オーバーラップ検出 & 色塗り -------------------------------------
function detectAndMarkOverlaps_(sheet, colMap) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < DATA_START_ROW) return { duplicateRows: 0 };
  var nRows = lastRow - DATA_START_ROW + 1;
  var values = sheet.getRange(DATA_START_ROW, 1, nRows, lastCol).getValues();

  var idC = colMap["id"];
  var dateC = colMap["実施年月日"];
  var startC = colMap["開始時間"];
  var endC = colMap["終了時間"];
  var dupC = colMap["重複するレコードID"];
  var delC = colMap["deletedAt"];

  // 比較可能な行だけ抽出
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[idC - 1] == null ? "" : row[idC - 1]).replace(/^\s+|\s+$/g, "");
    if (!id) continue;
    var del = row[delC - 1];
    if (del !== "" && del != null) continue; // ソフトデリート行は除外
    var startStr = normalizeTime_(row[startC - 1]);
    var endStr = normalizeTime_(row[endC - 1]);
    if (startStr === "終日" || endStr === "-" || !startStr || !endStr) continue;
    var startMin = parseTimeToMin_(startStr);
    var endMin = parseTimeToMin_(endStr);
    if (startMin == null || endMin == null) continue;
    if (endMin <= startMin) continue; // 終了 ≤ 開始 の壊れた区間 (例: 終了が翌日) は判定対象外
    rows.push({
      arrayIndex: i,
      rowIndex: DATA_START_ROW + i,
      id: id,
      date: normalizeDate_(row[dateC - 1]),
      startMin: startMin,
      endMin: endMin
    });
  }

  // 日付ごとにグルーピング
  var byDate = {};
  for (var r = 0; r < rows.length; r++) {
    var d = rows[r].date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(rows[r]);
  }

  // 各行について重複検出 (端は含めない: strict overlap)
  var dupMap = {}; // arrayIndex -> sorted ids[]
  for (var dKey in byDate) {
    if (!Object.prototype.hasOwnProperty.call(byDate, dKey)) continue;
    var list = byDate[dKey];
    for (var x = 0; x < list.length; x++) {
      var a = list[x];
      var overs = [];
      for (var y = 0; y < list.length; y++) {
        if (x === y) continue;
        var b = list[y];
        if (a.startMin < b.endMin && b.startMin < a.endMin) {
          overs.push(b.id);
        }
      }
      if (overs.length) {
        overs.sort();
        dupMap[a.arrayIndex] = overs;
      }
    }
  }

  // 重複列の書き戻し & 背景色の更新 (シート全体)
  var newDupValues = [];
  var newBackgrounds = [];
  var duplicateRows = 0;
  for (var rIdx = 0; rIdx < nRows; rIdx++) {
    var ids = dupMap[rIdx];
    newDupValues.push([ids ? ids.join(",") : ""]);
    var bgColor = ids ? DUPLICATE_COLOR : null;
    if (ids) duplicateRows++;
    var bgRow = new Array(lastCol);
    for (var c = 0; c < lastCol; c++) bgRow[c] = bgColor;
    newBackgrounds.push(bgRow);
  }
  sheet.getRange(DATA_START_ROW, dupC, nRows, 1).setValues(newDupValues);
  sheet.getRange(DATA_START_ROW, 1, nRows, lastCol).setBackgrounds(newBackgrounds);

  return { duplicateRows: duplicateRows };
}

function parseTimeToMin_(s) {
  var m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}


// ----- レコード ID 生成 (NFB の Nfb_generateRecordId_ と互換) -------------
var NFB_ULID_RANDOM_LENGTH = 16;
var __nfbLastUlidTs = -1;
var __nfbLastUlidRand = "";

function nfbUlidAlphabet_() {
  return "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
}

function nfbCreateRandomBytes_(n) {
  var b = [];
  for (var i = 0; i < n; i++) b.push(Math.floor(Math.random() * 256));
  return b;
}

function nfbToBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function nfbEncodeUlidTime_(ms) {
  var alpha = nfbUlidAlphabet_();
  var v = Math.floor(Number(ms));
  if (!isFinite(v) || v < 0) v = 0;
  var chars = [];
  for (var i = 0; i < 10; i++) {
    chars.unshift(alpha.charAt(v % 32));
    v = Math.floor(v / 32);
  }
  return chars.join("");
}

function nfbEncodeUlidRandom_(bytes) {
  var alpha = nfbUlidAlphabet_();
  var enc = "";
  var buf = 0;
  var bits = 0;
  for (var i = 0; i < bytes.length; i++) {
    buf = (buf << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      enc += alpha.charAt((buf >> (bits - 5)) & 31);
      bits -= 5;
      if (bits === 0) {
        buf = 0;
      } else {
        buf = buf & ((1 << bits) - 1);
      }
    }
  }
  if (bits > 0) enc += alpha.charAt((buf << (5 - bits)) & 31);
  return enc;
}

function nfbCreateUlidRandomPart_() {
  return nfbEncodeUlidRandom_(nfbCreateRandomBytes_(10)).substring(0, NFB_ULID_RANDOM_LENGTH);
}

function nfbIncrementUlidRandom_(value) {
  var alpha = nfbUlidAlphabet_();
  var chars = String(value || "").split("");
  while (chars.length < NFB_ULID_RANDOM_LENGTH) chars.push(alpha.charAt(0));
  if (chars.length > NFB_ULID_RANDOM_LENGTH) chars = chars.slice(0, NFB_ULID_RANDOM_LENGTH);
  for (var i = chars.length - 1; i >= 0; i--) {
    var idx = alpha.indexOf(chars[i]);
    var safe = idx >= 0 ? idx : 0;
    if (safe < alpha.length - 1) {
      chars[i] = alpha.charAt(safe + 1);
      for (var j = i + 1; j < chars.length; j++) chars[j] = alpha.charAt(0);
      return { value: chars.join(""), overflow: false };
    }
    chars[i] = alpha.charAt(0);
  }
  return { value: chars.join(""), overflow: true };
}

function nfbGenerateUlid_() {
  var now = Math.floor(Number(new Date().getTime()));
  if (!isFinite(now) || now < 0) now = 0;
  if (__nfbLastUlidTs < 0 || now > __nfbLastUlidTs) {
    __nfbLastUlidTs = now;
    __nfbLastUlidRand = nfbCreateUlidRandomPart_();
    return nfbEncodeUlidTime_(__nfbLastUlidTs) + __nfbLastUlidRand;
  }
  if (!__nfbLastUlidRand || __nfbLastUlidRand.length !== NFB_ULID_RANDOM_LENGTH) {
    __nfbLastUlidRand = nfbCreateUlidRandomPart_();
  }
  var inc = nfbIncrementUlidRandom_(__nfbLastUlidRand);
  if (inc.overflow) {
    __nfbLastUlidTs += 1;
    __nfbLastUlidRand = nfbCreateUlidRandomPart_();
  } else {
    __nfbLastUlidRand = inc.value;
  }
  return nfbEncodeUlidTime_(__nfbLastUlidTs) + __nfbLastUlidRand;
}

function generateRecordId_() {
  var ulid = nfbGenerateUlid_();
  var rand = nfbToBase64Url_(nfbCreateRandomBytes_(6)).substring(0, 8);
  return "r_" + ulid + "_" + rand;
}
