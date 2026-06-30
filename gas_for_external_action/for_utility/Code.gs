// =============================================================================
// NFB シートユーティリティ 外部アクション Web App (Nested Form Builder 連携)
//
// gas_for_spreadsheet/for_utility/SpreadsheetUtilities.gs を Web App として再構築。
// React (Builder) の外部アクションボタンが ?ssid=... (または adminOnly の
// payload.storage.spreadsheetId) 付きでこの URL を叩くと、ユーティリティ UI
// (Index.html) を表示する。UI から以下の操作を google.script.run で実行する:
//   1. createdAt 昇順ソート      (runSortByCreatedAt)
//   2. No. リナンバー            (runRenumber)
//   3. フォーム順で列を並べ替え  (runReorderColumns)
// access: MYSELF のため、実質的にデプロイ者 (管理者) 限定のボタンとなる。
// 操作対象は for_kouza と同様に "Data" シート固定。
//
// 共通仕様 (gas_for_spreadsheet/for_utility と同期維持):
//   - どの操作を実行しても modifiedAt 列は一切更新しない
//   - ヘッダー行 1〜11、データ開始行 12 (NFB 標準レイアウト)
//   - 固定列: id(1) No.(2) createdAt(3) modifiedAt(4) deletedAt(5)
//             createdBy(6) modifiedBy(7) deletedBy(8)
//
// 重要: 操作ロジック (NFBUtil 由来の run*_ / nfbu*_) は
// gas_for_spreadsheet/for_utility/SpreadsheetUtilities.gs と同期維持すること。
// 列定義・スキーマ展開ロジックを変えたら両方更新する必要がある。
// =============================================================================

// ----- 定数 ----------------------------------------------------------------
var SHEET_NAME            = "Data";
var NFBU_HEADER_DEPTH     = 11;
var NFBU_HEADER_START_ROW = 1;
var NFBU_DATA_START_ROW   = NFBU_HEADER_START_ROW + NFBU_HEADER_DEPTH; // 12
var NFBU_FIXED_COL_COUNT  = 8;
var NFBU_LOCK_WAIT_MS     = 10000;

// 固定ヘッダーパス
var NFBU_FIXED_HEADER_PATHS = [
  ["id"], ["No."], ["createdAt"], ["modifiedAt"],
  ["deletedAt"], ["createdBy"], ["modifiedBy"], ["deletedBy"]
];


// ----- Web App エントリ (ユーティリティ UI を表示) -------------------------
// GET: 手動アクセス・直リンク用に ?ssid= を読む。
// POST: Builder の外部アクションボタンが本体 GAS のサーバ間リレー (payload=JSON) で叩く。
//       (隠しフォーム POST はログインリダイレクトで本文を失うため廃止済み)
//       spreadsheetId は payload.storage.spreadsheetId に入る
//       (adminOnly && isAdmin のときだけ storage が付与される)。
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    return renderUtilityUi_(params.ssid);
  } catch (err) {
    return renderHtml_("予期せぬエラー", escapeHtml_(String(err && err.message ? err.message : err)), true);
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
    return renderUtilityUi_(ssid);
  } catch (err) {
    return renderHtml_("予期せぬエラー", escapeHtml_(String(err && err.message ? err.message : err)), true);
  }
}

// ユーティリティ UI (Index.html) をレンダリングする共通ヘルパ。doGet / doPost 双方から呼ぶ。
function renderUtilityUi_(ssid) {
  ssid = String(ssid || "").replace(/^\s+|\s+$/g, "");
  if (!ssid) {
    return renderHtml_("エラー", "操作対象スプレッドシートID が取得できませんでした。外部アクションボタンが管理者専用 (adminOnly) に設定され、管理者として実行しているか確認してください。", true);
  }

  var tpl = HtmlService.createTemplateFromFile("Index");
  tpl.ssid = ssid;
  tpl.ssName = resolveSpreadsheetName_(ssid); // 取得失敗時は ""
  tpl.sheetName = SHEET_NAME;
  return tpl.evaluate()
    .setTitle("NFB シートユーティリティ")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ----- 公開関数 (UI のボタンから google.script.run で呼ばれる) -------------

// 1. createdAt 昇順ソート
// アクティブシートではなく ssid の "Data" シートの 12 行目以降を createdAt 列
// (3列目) の昇順でソートする。Sheets 標準のソート機能を使うため高速。
// modifiedAt は更新しない。
function runSortByCreatedAt(payload) {
  payload = payload || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(NFBU_LOCK_WAIT_MS)) {
    return { ok: false, error: "他のユーザーが更新中です。少し待ってから再実行してください。" };
  }
  try {
    var sheet = nfbuOpenDataSheet_(payload.ssid);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < NFBU_DATA_START_ROW || lastCol < 1) {
      return { ok: false, error: "データ行がありません。" };
    }

    var numRows = lastRow - NFBU_DATA_START_ROW + 1;
    var dataRange = sheet.getRange(NFBU_DATA_START_ROW, 1, numRows, lastCol);
    // createdAt は 3列目（ascending: true）
    dataRange.sort({ column: 3, ascending: true });
    SpreadsheetApp.flush();
    return { ok: true, sortedRows: numRows };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    lock.releaseLock();
  }
}

// 2. No. リナンバー
// No. 列を上から連番 (1, 2, 3, ...) で振り直す。deletedAt が空白の行のみ連番を付与し、
// 削除済み行は空欄にする。modifiedAt は更新しない。
function runRenumber(payload) {
  payload = payload || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(NFBU_LOCK_WAIT_MS)) {
    return { ok: false, error: "他のユーザーが更新中です。少し待ってから再実行してください。" };
  }
  try {
    var sheet = nfbuOpenDataSheet_(payload.ssid);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < NFBU_DATA_START_ROW || lastCol < NFBU_FIXED_COL_COUNT) {
      return { ok: false, error: "データ行がありません。" };
    }

    var numRows = lastRow - NFBU_DATA_START_ROW + 1;
    // No. 列（2列目）と deletedAt 列（5列目）を読み取る
    var noRange = sheet.getRange(NFBU_DATA_START_ROW, 2, numRows, 1);
    var noValues = noRange.getValues();
    var deletedAtValues = sheet.getRange(NFBU_DATA_START_ROW, 5, numRows, 1).getValues();

    var seq = 1;
    for (var i = 0; i < numRows; i++) {
      if (nfbuHasValue_(deletedAtValues[i][0])) {
        noValues[i][0] = "";
      } else {
        noValues[i][0] = seq;
        seq++;
      }
    }

    noRange.setValues(noValues);
    SpreadsheetApp.flush();
    return { ok: true, numbered: seq - 1 };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    lock.releaseLock();
  }
}

// 3. フォーム順で列を並べ替え
// フォームJSON から列順序を構築し、シートの列を並べ替える。
// 固定列（1〜8）はそのまま、動的列（9列目〜）をフォーム順に並べ替える。
// フォームに存在しないシート上の列は末尾に追加する。modifiedAt は更新しない。
function runReorderColumns(payload) {
  payload = payload || {};
  var formUrl = String(payload.formUrl || "").replace(/^\s+|\s+$/g, "");
  if (!formUrl) {
    return { ok: false, error: "フォーム JSON の Google Drive URL または共有リンクを入力してください。" };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(NFBU_LOCK_WAIT_MS)) {
    return { ok: false, error: "他のユーザーが更新中です。少し待ってから再実行してください。" };
  }
  try {
    var sheet = nfbuOpenDataSheet_(payload.ssid);

    // フォームJSON を取得
    var formData;
    try {
      formData = nfbuFetchFormJson_(formUrl);
    } catch (e) {
      return { ok: false, error: "フォームの取得に失敗しました:\n" + (e && e.message ? e.message : e) };
    }

    var schema = formData.schema;
    if (!schema || !Array.isArray(schema) || schema.length === 0) {
      return { ok: false, error: "フォームにスキーマが含まれていません。" };
    }

    // フォームスキーマから列順序を構築
    var desiredOrder = nfbuBuildOrderFromSchema_(schema);
    if (desiredOrder.length === 0) {
      return { ok: false, error: "フォームスキーマから列が生成されませんでした。" };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastCol <= NFBU_FIXED_COL_COUNT) {
      return { ok: false, error: "動的列がありません。" };
    }

    // 現在のヘッダーマトリクスを読み取る
    var headerMatrix = sheet.getRange(NFBU_HEADER_START_ROW, 1, NFBU_HEADER_DEPTH, lastCol).getValues();

    // 現在の動的列のパスを取得（9列目以降）
    var currentDynamicPaths = []; // { colIndex: 0-based, key: "path|key" }
    for (var col = NFBU_FIXED_COL_COUNT; col < lastCol; col++) {
      var path = [];
      for (var row = 0; row < NFBU_HEADER_DEPTH; row++) {
        var cell = String(headerMatrix[row][col] || "");
        if (!cell) break;
        path.push(cell);
      }
      var key = path.join("|");
      currentDynamicPaths.push({ colIndex: col, key: key, path: path });
    }

    // desiredOrder に基づいて動的列の新しい順序を決定
    var dynamicKeyToIndex = {};
    for (var d = 0; d < currentDynamicPaths.length; d++) {
      dynamicKeyToIndex[currentDynamicPaths[d].key] = d;
    }

    var newOrder = [];  // currentDynamicPaths の index を新しい順序で格納
    var used = {};

    // まずフォーム順の列
    for (var k = 0; k < desiredOrder.length; k++) {
      var desiredKey = desiredOrder[k];
      if (dynamicKeyToIndex.hasOwnProperty(desiredKey) && !used[desiredKey]) {
        newOrder.push(dynamicKeyToIndex[desiredKey]);
        used[desiredKey] = true;
      }
    }

    // フォームに無い列は末尾に追加（元の順序を維持）
    for (var m = 0; m < currentDynamicPaths.length; m++) {
      if (!used[currentDynamicPaths[m].key]) {
        newOrder.push(m);
      }
    }

    // 順序が変わらない場合はスキップ
    var changed = false;
    for (var c = 0; c < newOrder.length; c++) {
      if (newOrder[c] !== c) { changed = true; break; }
    }
    if (!changed) {
      return { ok: true, changed: false, message: "列の順序は既にフォーム順です。変更の必要はありません。" };
    }

    // 全データを読み取り（ヘッダー＋データ）
    var totalRows = lastRow;
    var allData = sheet.getRange(1, 1, totalRows, lastCol).getValues();
    var allFormats = sheet.getRange(1, 1, totalRows, lastCol).getNumberFormats();

    // 列を並べ替えた新しい配列を構築
    var newAllData = [];
    var newAllFormats = [];

    for (var r = 0; r < totalRows; r++) {
      var newRowData = [];
      var newRowFormats = [];

      // 固定列（1〜8）はそのまま
      for (var f = 0; f < NFBU_FIXED_COL_COUNT; f++) {
        newRowData.push(allData[r][f]);
        newRowFormats.push(allFormats[r][f]);
      }

      // 動的列を新しい順序で並べる
      for (var n = 0; n < newOrder.length; n++) {
        var srcColIndex = currentDynamicPaths[newOrder[n]].colIndex;
        newRowData.push(allData[r][srcColIndex]);
        newRowFormats.push(allFormats[r][srcColIndex]);
      }

      newAllData.push(newRowData);
      newAllFormats.push(newRowFormats);
    }

    // シートに書き戻す
    var newColCount = newAllData[0].length;
    var writeRange = sheet.getRange(1, 1, totalRows, newColCount);
    writeRange.setValues(newAllData);
    writeRange.setNumberFormats(newAllFormats);

    // 余った列をクリア（元の列数 > 新しい列数の場合）
    if (lastCol > newColCount) {
      sheet.getRange(1, newColCount + 1, totalRows, lastCol - newColCount).clear();
    }

    SpreadsheetApp.flush();
    return {
      ok: true,
      changed: true,
      dynamicCols: newOrder.length,
      formCols: Object.keys(used).length
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    lock.releaseLock();
  }
}


// ----- 共通: ssid から "Data" シートを開く ---------------------------------
function nfbuOpenDataSheet_(ssid) {
  ssid = String(ssid || "").replace(/^\s+|\s+$/g, "");
  if (!ssid) throw new Error("操作対象スプレッドシートID (ssid) が指定されていません。");

  var ss;
  try {
    ss = SpreadsheetApp.openById(ssid);
  } catch (openErr) {
    throw new Error("スプレッドシートを開けませんでした (ssid=" + ssid + "): " + (openErr && openErr.message ? openErr.message : openErr));
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("「" + SHEET_NAME + "」シートが見つかりません。");
  return sheet;
}

function resolveSpreadsheetName_(ssid) {
  try {
    return SpreadsheetApp.openById(ssid).getName();
  } catch (err) {
    return "";
  }
}


// ----- 内部ヘルパー関数 (gas_for_spreadsheet/for_utility と同期維持) --------

/**
 * 値を比較可能な数値（Unix ミリ秒）に変換する。
 * Date オブジェクト、数値（Unix ms / Sheets シリアル値）、文字列に対応。
 */
function nfbuToComparableValue_(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (value instanceof Date) {
    var ms = value.getTime();
    return isFinite(ms) ? ms : 0;
  }
  if (typeof value === "number") {
    if (!isFinite(value)) return 0;
    // Sheets のシリアル値（< 100000000000 ≈ 約5000年）を判定
    if (value > 0 && value < 100000000000) {
      // Sheets シリアル値 → Unix ms に変換
      var SHEETS_EPOCH_MS = new Date(1899, 11, 30, 0, 0, 0).getTime();
      return SHEETS_EPOCH_MS + value * 86400000;
    }
    return value;
  }
  if (typeof value === "string") {
    var trimmed = value.trim();
    if (!trimmed) return 0;
    var numVal = Number(trimmed);
    if (isFinite(numVal)) return nfbuToComparableValue_(numVal);
    var dateMs = Date.parse(trimmed);
    if (isFinite(dateMs)) return dateMs;
  }
  return 0;
}

/**
 * 値が存在するか（空文字列・null・undefined でない）。
 */
function nfbuHasValue_(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (typeof value === "number" && isFinite(value)) return true;
  if (value instanceof Date) return true;
  return String(value).trim() !== "";
}

/**
 * フォームJSON を Google Drive URL から取得する。
 * Drive ファイルURL、共有リンク、直接ファイルIDに対応。
 */
function nfbuFetchFormJson_(urlOrId) {
  var fileId = nfbuExtractDriveFileId_(urlOrId);
  if (!fileId) {
    throw new Error("Google Drive のファイル ID を取得できませんでした。\n入力値: " + urlOrId);
  }

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    throw new Error("ファイルにアクセスできません（ID: " + fileId + "）。\n権限を確認してください。");
  }

  var content;
  try {
    content = file.getBlob().getDataAsString();
  } catch (e) {
    throw new Error("ファイルの読み取りに失敗しました: " + e.message);
  }

  var json;
  try {
    json = JSON.parse(content);
  } catch (e) {
    throw new Error("ファイルの内容が有効な JSON ではありません。");
  }

  return json;
}

/**
 * Google Drive の URL からファイル ID を抽出する。
 */
function nfbuExtractDriveFileId_(input) {
  var value = String(input || "").trim();
  if (!value) return "";

  // URL パターン: /d/{fileId}/ or /d/{fileId}
  var dMatch = value.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch && dMatch[1]) return dMatch[1];

  // URL パターン: ?id={fileId}
  var idMatch = value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) return idMatch[1];

  // URL パターン: open?id={fileId}
  var openMatch = value.match(/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch && openMatch[1]) return openMatch[1];

  // URL でなければ ID そのものとみなす
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;

  return "";
}

/**
 * フォームスキーマからカラムキーの順序配列を構築する。
 * gas/sheetsHeaders.gs の Sheets_buildOrderFromSchema_ と同等のロジック。
 */
function nfbuBuildOrderFromSchema_(schema) {
  var order = [];
  var seen = {};
  var singleValueTypes = {
    text: true, textarea: true, number: true, regex: true,
    date: true, time: true, url: true, userName: true, email: true, phone: true
  };

  var appendKey = function(key) {
    var normalized = String(key || "").trim();
    if (!normalized || seen[normalized]) return;
    seen[normalized] = true;
    order.push(normalized);
  };

  var resolveFieldLabel = function(field, indexTrail) {
    var label = field && field.label !== undefined && field.label !== null
      ? String(field.label).trim() : "";
    if (label) return label;
    var fieldType = field && field.type !== undefined && field.type !== null
      ? String(field.type).trim() : "";
    if (!fieldType) fieldType = "unknown";
    return "質問 " + indexTrail.join(".") + " (" + fieldType + ")";
  };

  var walk = function(fields, pathSegments, indexTrail) {
    if (!fields || !fields.length) return;
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!field || typeof field !== "object") continue;

      var currentIndexTrail = indexTrail.concat(i + 1);
      var label = resolveFieldLabel(field, currentIndexTrail);
      var currentPath = pathSegments.concat(label);
      var baseKey = currentPath.join("|");
      var type = field.type !== undefined && field.type !== null
        ? String(field.type).trim() : "";

      if (type === "checkboxes" || type === "radio" || type === "select") {
        if (Array.isArray(field.options)) {
          for (var optIndex = 0; optIndex < field.options.length; optIndex++) {
            var option = field.options[optIndex];
            var optionLabel = option && option.label !== undefined && option.label !== null
              ? String(option.label) : "";
            appendKey(optionLabel ? baseKey + "|" + optionLabel : baseKey + "|");
          }
        }
      } else if (type !== "message" && singleValueTypes[type]) {
        appendKey(baseKey);
      }

      if (field.childrenByValue && typeof field.childrenByValue === "object") {
        for (var childKey in field.childrenByValue) {
          if (!field.childrenByValue.hasOwnProperty(childKey)) continue;
          var childFields = field.childrenByValue[childKey];
          var optionPath = String(childKey || "");
          var childBasePath = optionPath ? currentPath.concat(optionPath) : currentPath;
          walk(childFields, childBasePath, currentIndexTrail);
        }
      }

      if (Array.isArray(field.children) && field.children.length > 0) {
        walk(field.children, currentPath, currentIndexTrail);
      }
    }
  };

  walk(Array.isArray(schema) ? schema : [], [], []);
  return order;
}


// ----- HTML レンダラ (for_kouza/Code.gs と同じ体裁) ------------------------
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
