// =============================================================================
// 環境共生担当課 カレンダー取込 Web App (Nested Form Builder 連携)
//
// for_kouza/Code.gs を Web App として再構築。
// React (Builder) の外部アクションボタンが GET でこの URL を ?ssid=... 付きで叩くと、
//   - 取込 UI (Index.html) を表示する。
//     カレンダー名・取込開始日・取込終了日を選び「取込実行」ボタンを押すと、
//     google.script.run.runImport(payload) が呼ばれる。
//   - runImport は選択カレンダーの指定期間から件名に「講座」を含むイベントを抽出し、
//     URL パラメータ ssid (フォームデータ由来) のスプレッドシート Data シートに upsert する。
//   access: MYSELF のため、実質的にデプロイ者 (管理者) 限定のボタンとなる。
//
// 重要: upsert / 取得ロジック (fetchCalendarEvents_ / parseEvent_ / buildHeaderKeyMap_ /
// readDataRows_ / upsertEvents_ / matchKeyFrom*_ / applyEventToRow_ /
// detectAndMarkOverlaps_ / listCalendarsForUi_ / defaultDateRange_ 等) は
// gas_for_spreadsheet/for_kouza/Code.gs と同期維持すること。マッチキー定義や列定義を
// 変えたら両方更新する必要がある。
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

var REQUIRED_COLUMNS = [
  "id", "No.", "createdAt", "modifiedAt", "deletedAt", "createdBy", "modifiedBy", "deletedBy",
  "実施年月日", "開始時間", "終了時間",
  TYPE_COL_HIGUMA, TYPE_COL_DEMAE,
  "場所", "組織名等", "人数", "（参考）", "重複するレコードID"
];


// ----- Web App エントリ (取込 UI を表示) ----------------------------------
// GET: 手動アクセス・直リンク用に ?ssid= を読む。
// POST: Builder の外部アクションボタンが隠しフォーム (payload=JSON) で叩く。
//       spreadsheetId は payload.storage.spreadsheetId に入る
//       (adminOnly && isAdmin のときだけ storage が付与される)。
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    return renderImportUi_(params.ssid);
  } catch (err) {
    return renderHtml_("予期せぬエラー", String(err && err.message ? err.message : err), true);
  }
}

function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    var ssid = "";
    if (params.payload) {
      var payload;
      try {
        payload = JSON.parse(params.payload);
      } catch (parseErr) {
        return renderHtml_("エラー", "受信データ (payload) を解析できませんでした。", true);
      }
      if (payload && payload.storage && payload.storage.spreadsheetId) {
        ssid = payload.storage.spreadsheetId;
      }
    }
    if (!ssid && params.ssid) ssid = params.ssid;
    return renderImportUi_(ssid);
  } catch (err) {
    return renderHtml_("予期せぬエラー", String(err && err.message ? err.message : err), true);
  }
}

// 取込 UI (Index.html) をレンダリングする共通ヘルパ。doGet / doPost 双方から呼ぶ。
function renderImportUi_(ssid) {
  ssid = String(ssid || "").replace(/^\s+|\s+$/g, "");
  if (!ssid) {
    return renderHtml_("エラー", "取込先スプレッドシートID が取得できませんでした。外部アクションボタンが管理者専用 (adminOnly) に設定され、管理者として実行しているか確認してください。", true);
  }

  var tpl = HtmlService.createTemplateFromFile("Index");
  tpl.ssid = ssid;
  tpl.ssName = resolveSpreadsheetName_(ssid); // 取得失敗時は ""
  tpl.calendars = listCalendarsForUi_();
  var defaults = defaultDateRange_();
  tpl.defaultStartDate = defaults.start; // 既定: 先月の 1 日
  tpl.defaultEndDate = defaults.end;     // 既定: 今月の末日
  return tpl.evaluate()
    .setTitle("カレンダー取込")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ----- メイン処理 (UI の「取込実行」ボタンから google.script.run で呼ばれる公開関数) ----
function runImport(payload) {
  payload = payload || {};
  var ssid = String(payload.ssid || "").replace(/^\s+|\s+$/g, "");
  if (!ssid) {
    return { ok: false, error: "取込先スプレッドシートID (ssid) が指定されていません。" };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return { ok: false, error: "他のユーザーが更新中です。少し待ってから再実行してください。" };
  }
  try {
    var ss;
    try {
      ss = SpreadsheetApp.openById(ssid);
    } catch (openErr) {
      return { ok: false, error: "スプレッドシートを開けませんでした (ssid=" + ssid + "): " + (openErr && openErr.message ? openErr.message : openErr) };
    }
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

    var events = fetchCalendarEvents_(payload);
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


// ----- UI 用ヘルパ (gas_for_spreadsheet/for_kouza と同期維持) ---------------
function resolveSpreadsheetName_(ssid) {
  try {
    return SpreadsheetApp.openById(ssid).getName();
  } catch (err) {
    return "";
  }
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


// ----- カレンダー イベント抽出 (カレンダーID + 期間指定) -------------------
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

  var hasHiguma = title.indexOf("ヒグマ") !== -1;
  var hasDemae = title.indexOf("出前") !== -1;
  if (hasHiguma && hasDemae) {
    var kouzaIdx = title.indexOf("講座");
    if (kouzaIdx !== -1) {
      var higumaLast = title.lastIndexOf("ヒグマ");
      var demaeLast = title.lastIndexOf("出前");
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
    }
  }

  var typeStr = "";
  if (hasHiguma && hasDemae) typeStr = "ヒグマ・出前講座";
  else if (hasHiguma) typeStr = "ヒグマ講座";
  else if (hasDemae) typeStr = "出前講座";

  var peopleCount = "";
  var textToSearch = title + " \n " + desc;
  var m = textToSearch.match(/([0-9０-９]+)[\s　]?([名人])/);
  if (m) {
    peopleCount = m[1].replace(/[０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    });
  }

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
  var delC = colMap["deletedAt"];

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[idC - 1] == null ? "" : row[idC - 1]).replace(/^\s+|\s+$/g, "");
    if (!id) continue;
    var del = row[delC - 1];
    out.push({
      rowIndex: DATA_START_ROW + i,
      id: id,
      deleted: (del !== "" && del != null), // ソフトデリート行か
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

  // ソフトデリート行はマッチ (上書き) 対象外。索引に入れないことで、
  // 同一キーのイベントが来ても復活させず新規行として追加する。
  var keyToExisting = {};
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].deleted) continue;
    var k = matchKeyFromRecord_(existing[i]);
    keyToExisting[k] = existing[i];
  }

  // No. 採番はソフトデリート行も含めて最大値を取る (削除済み行との No. 衝突を防ぐ)。
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
      var existingRow = sheet.getRange(match.rowIndex, 1, 1, lastCol).getValues()[0];
      applyEventToRow_(existingRow, ev, colMap);
      existingRow[colMap["modifiedAt"] - 1] = now;
      existingRow[colMap["modifiedBy"] - 1] = email;
      // match はソフトデリート行を除外済みなので、ここは通常空のまま。念のため明示クリア。
      existingRow[colMap["deletedAt"] - 1] = "";
      existingRow[colMap["deletedBy"] - 1] = "";
      writeRow_(sheet, match.rowIndex, existingRow, colMap);
      updated++;
    } else {
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
}

function dateStringToValue_(s) {
  if (!s) return "";
  var m = String(s).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0);
}

function timeStringToValue_(s) {
  if (!s) return "";
  if (s === "終日" || s === "-") return s;
  var m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;
  return new Date(1899, 11, 30, Number(m[1]), Number(m[2]), 0);
}

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

  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[idC - 1] == null ? "" : row[idC - 1]).replace(/^\s+|\s+$/g, "");
    if (!id) continue;
    var del = row[delC - 1];
    if (del !== "" && del != null) continue;
    var startStr = normalizeTime_(row[startC - 1]);
    var endStr = normalizeTime_(row[endC - 1]);
    if (startStr === "終日" || endStr === "-" || !startStr || !endStr) continue;
    var startMin = parseTimeToMin_(startStr);
    var endMin = parseTimeToMin_(endStr);
    if (startMin == null || endMin == null) continue;
    if (endMin <= startMin) continue;
    rows.push({
      arrayIndex: i,
      rowIndex: DATA_START_ROW + i,
      id: id,
      date: normalizeDate_(row[dateC - 1]),
      startMin: startMin,
      endMin: endMin
    });
  }

  var byDate = {};
  for (var r = 0; r < rows.length; r++) {
    var d = rows[r].date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(rows[r]);
  }

  var dupMap = {};
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


// ----- HTML レンダラ -------------------------------------------------------
function renderHtml_(title, bodyHtml, isError) {
  var bg = isError ? "#FEECEC" : "#E8F0FE";
  var border = isError ? "#D93025" : "#1A73E8";
  var html =
    '<!DOCTYPE html>' +
    '<html lang="ja"><head><meta charset="utf-8"><title>' + escapeHtml_(title) + '</title>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans JP",sans-serif;background:#f8f9fa;margin:0;padding:24px;color:#202124;}' +
    '.card{max-width:640px;margin:0 auto;background:' + bg + ';border:2px solid ' + border + ';border-radius:8px;padding:20px 24px;}' +
    'h1{font-size:18px;margin:0 0 12px;color:' + border + ';}' +
    'p{font-size:14px;line-height:1.6;margin:8px 0;}' +
    '.small{font-size:12px;color:#5f6368;margin-top:16px;}' +
    '</style></head>' +
    '<body><div class="card">' +
    '<h1>' + escapeHtml_(title) + '</h1>' +
    '<p>' + bodyHtml + '</p>' +
    '<p class="small">このタブは閉じて差し支えありません。</p>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
