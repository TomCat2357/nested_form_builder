/**
 * SpreadsheetUtilities.gs
 *
 * 保存先スプレッドシートに直接貼り付けて使うユーティリティ関数群。
 * メニューから実行するか、関数を直接実行する。
 *
 * 提供機能:
 *   1. NFBUtil_sortByCreatedAt      — createdAt 昇順でデータ行をソート（Sheets 標準ソート使用）
 *   2. NFBUtil_renumber             — No. 列を連番で振り直す（deletedAt が空白の行のみ対象）
 *   3. NFBUtil_reorderColumnsByForm — フォームJSON の URL を指定して列をフォーム順に並べ替える
 *
 * 共通仕様:
 *   - どの操作を実行しても modifiedAt 列は一切更新しない
 *   - ヘッダー行 1〜11、データ開始行 12（NFB 標準レイアウト）
 *   - 固定列: id(1), No.(2), createdAt(3), modifiedAt(4), deletedAt(5),
 *             createdBy(6), modifiedBy(7), deletedBy(8)
 */

// ============================================================
// 定数
// ============================================================
var NFBU_HEADER_DEPTH     = 11;
var NFBU_HEADER_START_ROW = 1;
var NFBU_DATA_START_ROW   = NFBU_HEADER_START_ROW + NFBU_HEADER_DEPTH; // 12
var NFBU_FIXED_COL_COUNT  = 8;

// 固定ヘッダーパス
var NFBU_FIXED_HEADER_PATHS = [
  ["id"], ["No."], ["createdAt"], ["modifiedAt"],
  ["deletedAt"], ["createdBy"], ["modifiedBy"], ["deletedBy"]
];

// ============================================================
// メニュー登録
// ============================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("NFB ユーティリティ")
    .addItem("createdAt 順にソート", "NFBUtil_sortByCreatedAt")
    .addItem("No. リナンバー", "NFBUtil_renumber")
    .addItem("フォーム順で列を並べ替え", "NFBUtil_reorderColumnsByFormMenu")
    .addToUi();
}

// ============================================================
// 1. createdAt 順ソート
// ============================================================
/**
 * アクティブシートのデータ行（12行目以降）を createdAt 列（3列目）の昇順でソートする。
 * Sheets 標準のソート機能を使用するため高速。modifiedAt は更新しない。
 */
function NFBUtil_sortByCreatedAt() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < NFBU_DATA_START_ROW || lastCol < 1) {
    SpreadsheetApp.getUi().alert("データ行がありません。");
    return;
  }

  var numRows = lastRow - NFBU_DATA_START_ROW + 1;
  var dataRange = sheet.getRange(NFBU_DATA_START_ROW, 1, numRows, lastCol);
  // createdAt は 3列目（ascending: true）
  dataRange.sort({ column: 3, ascending: true });
  SpreadsheetApp.getUi().alert("createdAt 順にソートしました（" + numRows + " 行）。");
}

// ============================================================
// 2. No. リナンバー
// ============================================================
/**
 * No. 列を上から連番（1, 2, 3, ...）で振り直す。
 * deletedAt が空白の行のみ連番を付与し、削除済み行は空欄にする。
 */
function NFBUtil_renumber() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < NFBU_DATA_START_ROW || lastCol < NFBU_FIXED_COL_COUNT) {
    SpreadsheetApp.getUi().alert("データ行がありません。");
    return;
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
  SpreadsheetApp.getUi().alert("No. をリナンバーしました（" + (seq - 1) + " 件に番号付与、削除済みは空欄）。");
}

// ============================================================
// 3. フォーム順で列を並べ替え
// ============================================================
/**
 * メニューから呼ばれるエントリーポイント。
 * フォームJSON の URL をダイアログで入力させる。
 */
function NFBUtil_reorderColumnsByFormMenu() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    "フォーム順で列を並べ替え",
    "フォーム JSON の Google Drive URL または共有リンクを入力してください：",
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var url = result.getResponseText().trim();
  if (!url) {
    ui.alert("URL が入力されていません。");
    return;
  }
  NFBUtil_reorderColumnsByForm(url);
}

/**
 * フォームJSON から列順序を構築し、シートの列を並べ替える。
 * 固定列（1〜8）はそのまま、動的列（9列目〜）をフォーム順に並べ替える。
 * フォームに存在しないシート上の列は末尾に追加する。
 * modifiedAt は更新しない。
 *
 * @param {string} formUrl  Google Drive のファイル URL
 */
function NFBUtil_reorderColumnsByForm(formUrl) {
  var ui = SpreadsheetApp.getUi();

  // フォームJSON を取得
  var formData;
  try {
    formData = nfbuFetchFormJson_(formUrl);
  } catch (e) {
    ui.alert("フォームの取得に失敗しました:\n" + e.message);
    return;
  }

  var schema = formData.schema;
  if (!schema || !Array.isArray(schema) || schema.length === 0) {
    ui.alert("フォームにスキーマが含まれていません。");
    return;
  }

  // フォームスキーマから列順序を構築
  var desiredOrder = nfbuBuildOrderFromSchema_(schema);
  if (desiredOrder.length === 0) {
    ui.alert("フォームスキーマから列が生成されませんでした。");
    return;
  }

  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastCol <= NFBU_FIXED_COL_COUNT) {
    ui.alert("動的列がありません。");
    return;
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
    ui.alert("列の順序は既にフォーム順です。変更の必要はありません。");
    return;
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
  ui.alert(
    "列をフォーム順に並べ替えました。\n" +
    "動的列: " + newOrder.length + " 列\n" +
    "（フォーム由来: " + Object.keys(used).length + " 列）"
  );
}

// ============================================================
// 内部ヘルパー関数
// ============================================================

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
