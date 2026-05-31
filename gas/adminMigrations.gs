/**
 * 管理者向け移行スクリプト集（Plan P4 / P5）。
 *
 * 既存データの破壊的変更を伴うため、本番フォームに対しては
 * 必ず以下の前提で実行する:
 *   1. 移行前に対象スプレッドシートのバックアップを取る（コピー作成）
 *   2. 同期を停止し、ユーザの編集が走らない状態で実行する
 *   3. 1 フォームずつ実行し、結果を検証してから次へ
 *
 * これらの関数は GAS の Apps Script エディタから手動で呼び出すことを想定。
 * Web アプリの公開 API には登録しない。
 */

// ============================================================================
// § メタ日時を「数値の日時シリアル値」に戻すマイグレーション
//   シートの createdAt / modifiedAt / deletedAt 列を JST 文字列 / Unix ms 数値から
//   数値の日時 (Date オブジェクト) に書き戻す。
//   numberFormat も yyyy/mm/dd hh:mm:ss に変更する。
//   ※ アプリ内部 / JSON / キャッシュは引き続き canonical 文字列（読み戻し時に正規化）。
// ============================================================================

/**
 * 単一スプレッドシート・単一シートのメタ日時列を「数値の日時」に移行する。
 *
 * @param {string} spreadsheetId 対象 spreadsheetId
 * @param {string} [sheetName] 対象シート名（省略時は NFB_DEFAULT_SHEET_NAME）
 * @return {{ok: boolean, updatedRows: number, errors: Array<string>}}
 */
function Admin_migrateMetaDatetimesToSheetDates_(spreadsheetId, sheetName) {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var name = sheetName || NFB_DEFAULT_SHEET_NAME;
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    return { ok: false, updatedRows: 0, errors: ["Sheet '" + name + "' not found"] };
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < NFB_DATA_START_ROW || lastCol < 1) {
    return { ok: true, updatedRows: 0, errors: [] };
  }

  var fixedColMap = Sheets_buildFixedColMapFromSheet_(sheet);
  // 0-based 列インデックス。fixedColMap は 0-based（NFB_FIXED_HEADER_PATHS 順）
  var createdAtCol = fixedColMap.hasOwnProperty("createdAt") ? fixedColMap.createdAt : 2;
  var modifiedAtCol = fixedColMap.hasOwnProperty("modifiedAt") ? fixedColMap.modifiedAt : 3;
  var deletedAtCol = fixedColMap.hasOwnProperty("deletedAt") ? fixedColMap.deletedAt : 4;

  var rowCount = lastRow - NFB_DATA_START_ROW + 1;
  var range = sheet.getRange(NFB_DATA_START_ROW, 1, rowCount, lastCol);
  var values = range.getValues();
  var errors = [];
  var updated = 0;

  var migrate = function(i, colIdx) {
    if (colIdx < 0 || colIdx >= values[i].length) return false;
    var v = values[i][colIdx];
    if (v === null || v === undefined || v === "") return false;
    // すでに Date（数値の日時）ならスキップ（再実行時の冪等性）
    if (Sheets_isValidDate_(v)) return false;
    var unixMs = Sheets_toStrictUnixMs_(v);
    if (unixMs === null || !isFinite(unixMs)) {
      errors.push("Row " + (i + NFB_DATA_START_ROW) + " col " + (colIdx + 1) + ": failed to parse datetime value '" + String(v) + "'");
      return false;
    }
    var d = new Date(unixMs);
    if (isNaN(d.getTime())) {
      errors.push("Row " + (i + NFB_DATA_START_ROW) + " col " + (colIdx + 1) + ": invalid date from value '" + String(v) + "'");
      return false;
    }
    values[i][colIdx] = d;
    return true;
  };

  for (var i = 0; i < values.length; i++) {
    var changed = false;
    if (migrate(i, createdAtCol)) changed = true;
    if (migrate(i, modifiedAtCol)) changed = true;
    if (migrate(i, deletedAtCol)) changed = true;
    if (changed) updated++;
  }

  if (updated > 0) {
    range.setValues(values);
  }

  // numberFormat を yyyy/mm/dd hh:mm:ss に切り替え
  if (createdAtCol >= 0) {
    sheet.getRange(NFB_DATA_START_ROW, createdAtCol + 1, rowCount, 1).setNumberFormat(NFB_SHEETS_DATETIME_FORMAT);
  }
  if (modifiedAtCol >= 0) {
    sheet.getRange(NFB_DATA_START_ROW, modifiedAtCol + 1, rowCount, 1).setNumberFormat(NFB_SHEETS_DATETIME_FORMAT);
  }
  if (deletedAtCol >= 0) {
    sheet.getRange(NFB_DATA_START_ROW, deletedAtCol + 1, rowCount, 1).setNumberFormat(NFB_SHEETS_DATETIME_FORMAT);
  }

  return { ok: errors.length === 0, updatedRows: updated, errors: errors };
}

/**
 * すべての登録済みフォームの紐付けスプレッドシートに対して
 * Admin_migrateMetaDatetimesToSheetDates_ を順次実行する。
 *
 * 実行時間制限（6 分）を考慮し、進捗を Logger に出す。
 *
 * @return {{processedForms: number, totalUpdatedRows: number, errors: Array}}
 */
function Admin_migrateAllFormsMetaDatetimesToSheetDates_() {
  var mapping = Forms_loadFormMapping_ ? Forms_loadFormMapping_() : null;
  if (!mapping || typeof mapping !== "object") {
    return { processedForms: 0, totalUpdatedRows: 0, errors: ["Form mapping unavailable"] };
  }
  var processed = 0;
  var totalUpdated = 0;
  var errors = [];

  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    try {
      var form = Forms_getForm_(formId);
      if (!form || !form.settings) continue;
      var spreadsheetId = form.settings.spreadsheetId;
      var sheetName = form.settings.sheetName || NFB_DEFAULT_SHEET_NAME;
      if (!spreadsheetId) continue;

      Logger.log("[migrate] form=" + formId + " ss=" + spreadsheetId + " sheet=" + sheetName);
      var result = Admin_migrateMetaDatetimesToSheetDates_(spreadsheetId, sheetName);
      processed++;
      totalUpdated += result.updatedRows || 0;
      if (result.errors && result.errors.length) {
        errors.push({ formId: formId, errors: result.errors });
      }
      Logger.log("[migrate] form=" + formId + " updated=" + result.updatedRows);
    } catch (e) {
      errors.push({ formId: formId, error: String(e) });
    }
  }
  return { processedForms: processed, totalUpdatedRows: totalUpdated, errors: errors };
}

// ============================================================================
// § Plan P5: NFB_* UDF リネームマイグレーション
//   保存済みフォーム JSON 中の `NFB_X(` を新名 / alasql 組込みに書き換える。
//   テンプレート文字列・計算フィールド式・印刷テンプレ等が対象。
// ============================================================================

/**
 * NFB_* UDF 名 → 新名 / alasql 組込み への置換テーブル。
 * 注: 単純文字列置換ではコメント内 / 文字列リテラル内も誤って書き換える可能性があるため、
 *     関数識別子トークンとして出現する文脈（直後に `(` が続く）を狙う。
 */
var NFB_UDF_RENAME_TABLE_ = [
  // 関数本体は prefix-less に rename
  { from: "NFB_LIKE_ANY", to: "LIKE_ANY" },
  { from: "NFB_PARSE_DATE", to: "DATE" },
  { from: "NFB_TIME_FORMAT", to: "TIME_FORMAT" },
  { from: "NFB_NUMBER_FORMAT", to: "NUMBER_FORMAT" },
  { from: "NFB_KANA", to: "KANA" },
  { from: "NFB_ZEN", to: "ZEN" },
  { from: "NFB_HAN", to: "HAN" },
  { from: "NFB_NOEXT", to: "NOEXT" },
  { from: "NFB_FILE_NAMES", to: "FILE_NAMES" },
  { from: "NFB_FILE_URLS", to: "FILE_URLS" },
  { from: "NFB_FOLDER_NAME", to: "FOLDER_NAME" },
  { from: "NFB_FOLDER_URL", to: "FOLDER_URL" },
  // alasql / GAS 組込みで置換可能なもの
  { from: "NFB_REGEX_MATCH", to: "REGEXP_MATCH" },
  { from: "NFB_TO_BOOL", to: "CAST_AS_BOOLEAN_FROM_NFB_TO_BOOL_PLACEHOLDER" }, // 後段で CAST に展開
  { from: "NFB_TO_NUMBER", to: "CAST_AS_NUMBER_FROM_NFB_TO_NUMBER_PLACEHOLDER" },
  { from: "NFB_REGEX_TEST", to: "REGEX_TEST_NFB_PLACEHOLDER" },
  { from: "NFB_DEFAULT", to: "NFB_DEFAULT_PLACEHOLDER" },
  { from: "NFB_PAD_LEFT", to: "LPAD" },
  { from: "NFB_PAD_RIGHT", to: "RPAD" },
  { from: "NFB_DATE_BIN", to: "NFB_DATE_BIN_PLACEHOLDER" },
  // prefix-less 旧名 → 新名（PARSE_DATE 完全削除 / PAD_* → LPAD/RPAD）
  { from: "PARSE_DATE", to: "DATE" },
  { from: "PAD_LEFT", to: "LPAD" },
  { from: "PAD_RIGHT", to: "RPAD" },
  // 正規表現 UDF 簡素化（PR #164 後継）:
  //   自前 UDF を REGEXP_MATCH / REGEXP_REPLACE の 2 つに絞り、判定はネイティブ
  //   REGEXP_LIKE / REGEXP 演算子に委ねた。旧名を新仕様へ移す。
  //   REGEX_MATCH → REGEXP_MATCH（戻り値 / 引数互換）
  //   REGEX_TEST(x, p) → REGEXP_LIKE(x, p, 'i')（case-insensitive 維持）
  //   REGEX_EXTRACT(x, p[, i])（2/3 引数） → REGEXP_MATCH(x, p[, i])
  //   REGEX_EXTRACT(x, p, i, flags)（4 引数） → 書き換え不可。元式維持 + Logger 警告。
  //   REGEX_EXTRACT_ALL(...) → 廃止。元式維持 + Logger 警告。
  { from: "REGEX_MATCH", to: "REGEXP_MATCH" },
  { from: "REGEX_TEST", to: "REGEX_TEST_PLACEHOLDER" },
  { from: "REGEX_EXTRACT_ALL", to: "REGEX_EXTRACT_ALL_REMOVED_PLACEHOLDER" },
  { from: "REGEX_EXTRACT", to: "REGEXP_MATCH_FROM_REGEX_EXTRACT_PLACEHOLDER" },
  // DATE/DATETIME/TIME 型整備（仕様改定）: 廃止・改名された日付 UDF
  //   DATETIME2ERA → DATETIME2ERATIME（注: 出力書式が「令和7年5月6日 14:35:48」→
  //     「令和7年5月6日 14時35分48秒」に変わる。和暦+時刻という意味は同じ。日付↔時刻は半角スペース）
  //   ERA2DATETIME → ERATIME2DATETIME（戻り値は unix ms → "YYYY/MM/DD HH:mm:ss.SSS" 文字列に変化）
  //   DATE_BIN(x,n) は廃止 → SUBSTRING(DATETIME(x),1,n) に展開
  //   TIME_SECONDS(x) は廃止 → (HOUR(x)*3600 + MINUTE(x)*60 + SECOND(x)) に展開
  { from: "DATETIME2ERA", to: "DATETIME2ERATIME" },
  { from: "ERA2DATETIME", to: "ERATIME2DATETIME" },
  { from: "DATE_BIN", to: "NFB_DATE_BIN_PLACEHOLDER" },
  { from: "TIME_SECONDS", to: "NFB_TIME_SECONDS_PLACEHOLDER" },
];

/**
 * 文字列内の NFB_* 関数呼び出しを新名で書き換える（identifier 文脈のみ）。
 * シンプルな regex 置換を 2 段階で実施:
 *   1. 直接 rename テーブルでの 1 対 1 置換（呼び出し位置 = 直後に '(' があるもの）
 *   2. プレースホルダの本格的な構文書換は別パスで（CAST/IFNULL 等）
 *
 * NOTE: 文字列リテラル内 (`'NFB_X(...)'` のように引用符内) は対象に含めない。
 *       簡易実装として「直前文字が `[A-Za-z0-9_]` でない」「直後に `\s*\(` がある」両方を満たす場合のみ置換。
 */
function Admin_rewriteNfbUdfsInExpressionString_(text) {
  if (typeof text !== "string" || !text) return text;
  var result = text;

  // _NOW 予約トークン廃止: バッククォート識別子 `_NOW` を NOW() 関数呼び出しに置換。
  // ファイル名 / フォルダ名 / Gmail テンプレ / 置換フィールド等で {`_NOW`} や
  // {TIME_FORMAT(`_NOW`, 'YYYY-MM-DD')} の形で使われていた既存トークンを救済する。
  result = result.replace(/`_NOW`/g, "NOW()");

  // ステージ 1: 単純な 1:1 リネーム（プレースホルダ込み）
  for (var i = 0; i < NFB_UDF_RENAME_TABLE_.length; i++) {
    var entry = NFB_UDF_RENAME_TABLE_[i];
    var pattern = new RegExp("(^|[^A-Za-z0-9_])" + entry.from + "(\\s*\\()", "g");
    result = result.replace(pattern, "$1" + entry.to + "$2");
  }

  // ステージ 2: プレースホルダを alasql 組込み式に展開
  //   NFB_TO_BOOL(x) → CAST(x AS BOOLEAN)
  //   NFB_TO_NUMBER(x) → CAST(x AS NUMBER)
  //   NFB_DEFAULT(x, y) → IFNULL(NULLIF(x, ''), y)
  //   NFB_REGEX_TEST(x, p) / REGEX_TEST(x, p) → REGEXP_LIKE(x, p, 'i')（case-insensitive 維持）
  //   REGEX_EXTRACT(x, p[, i]) → REGEXP_MATCH(x, p[, i])（2/3 引数互換）
  //   REGEX_EXTRACT(x, p, i, flags) → 元式維持 + Logger 警告（書き換え不可）
  //   REGEX_EXTRACT_ALL(...) → 元式維持 + Logger 警告（廃止）
  //   (NFB_)DATE_BIN(x, n) → SUBSTRING(DATETIME(x), 1, n)
  //   TIME_SECONDS(x) → (HOUR(x)*3600 + MINUTE(x)*60 + SECOND(x))
  // これらは引数を含む構文書換なのでバランスドパースが必要。
  // 簡易版として 1 引数 / 2 引数の括弧マッチを試みる。
  result = Admin_expandSimpleCallTemplate_(result, "CAST_AS_BOOLEAN_FROM_NFB_TO_BOOL_PLACEHOLDER", function(args) {
    return "CAST(" + args[0] + " AS BOOLEAN)";
  });
  result = Admin_expandSimpleCallTemplate_(result, "CAST_AS_NUMBER_FROM_NFB_TO_NUMBER_PLACEHOLDER", function(args) {
    return "CAST(" + args[0] + " AS NUMBER)";
  });
  result = Admin_expandSimpleCallTemplate_(result, "REGEX_TEST_NFB_PLACEHOLDER", function(args) {
    return "REGEXP_LIKE(" + args[0] + ", " + (args[1] || "''") + ", 'i')";
  });
  result = Admin_expandSimpleCallTemplate_(result, "REGEX_TEST_PLACEHOLDER", function(args) {
    return "REGEXP_LIKE(" + args[0] + ", " + (args[1] || "''") + ", 'i')";
  });
  result = Admin_expandSimpleCallTemplate_(result, "REGEXP_MATCH_FROM_REGEX_EXTRACT_PLACEHOLDER", function(args) {
    // 旧 REGEX_EXTRACT は 2/3 引数までは新 REGEXP_MATCH と互換（戻り値が "" / null で異なるが、
    // 述語コンテキスト IS NOT NULL は概ね同等 — 全件マッチ確認の用途では空文字も "存在" と判定される）。
    // 4 引数版（flags）は移行不可なので元式を復元し、警告を残す。
    if (args.length >= 4) {
      var original = "REGEX_EXTRACT(" + args.join(", ") + ")";
      Admin_logUdfMigrationWarning_("REGEX_EXTRACT 4-arg (flags) は新仕様に移行できません — 手動で代替実装を書いてください", original);
      return original;
    }
    return "REGEXP_MATCH(" + args.join(", ") + ")";
  });
  result = Admin_expandSimpleCallTemplate_(result, "REGEX_EXTRACT_ALL_REMOVED_PLACEHOLDER", function(args) {
    var original = "REGEX_EXTRACT_ALL(" + args.join(", ") + ")";
    Admin_logUdfMigrationWarning_("REGEX_EXTRACT_ALL は廃止されました — 手動で代替実装を書いてください", original);
    return original;
  });
  result = Admin_expandSimpleCallTemplate_(result, "NFB_DEFAULT_PLACEHOLDER", function(args) {
    return "IFNULL(NULLIF(" + args[0] + ", ''), " + (args[1] || "''") + ")";
  });
  result = Admin_expandSimpleCallTemplate_(result, "NFB_DATE_BIN_PLACEHOLDER", function(args) {
    return "SUBSTRING(DATETIME(" + args[0] + "), 1, " + (args[1] || "10") + ")";
  });
  result = Admin_expandSimpleCallTemplate_(result, "NFB_TIME_SECONDS_PLACEHOLDER", function(args) {
    return "(HOUR(" + args[0] + ") * 3600 + MINUTE(" + args[0] + ") * 60 + SECOND(" + args[0] + "))";
  });
  return result;
}

/**
 * 現在マイグレーション中のフォーム ID。Admin_migrateNfbUdfNamesInForms_ がループ内で
 * 都度書き換える。Admin_logUdfMigrationWarning_ から参照される。
 */
var Admin_currentMigratingFormId_ = "";

/**
 * UDF マイグレーションで「自動書き換え不可」な式に遭遇したときの警告ロガー。
 * 対象フォーム ID と元式を Logger に出力する（GAS 外では console.warn にフォールバック）。
 */
function Admin_logUdfMigrationWarning_(reason, expr) {
  var ctx = Admin_currentMigratingFormId_ ? "form=" + Admin_currentMigratingFormId_ : "form=<unknown>";
  var msg = "[migrate-warn] " + ctx + " reason=" + reason + " expr=" + expr;
  if (typeof Logger !== "undefined" && Logger && typeof Logger.log === "function") {
    Logger.log(msg);
  } else if (typeof console !== "undefined" && console && typeof console.warn === "function") {
    console.warn(msg);
  }
}

/**
 * `funcName(arg1, arg2, ...)` の呼び出しをパースし、replacer で書き換える。
 * 引数のカンマ split はネストした括弧 / 文字列リテラルを尊重する。
 */
function Admin_expandSimpleCallTemplate_(text, funcName, replacer) {
  var idx = 0;
  var out = "";
  while (idx < text.length) {
    var found = text.indexOf(funcName + "(", idx);
    if (found < 0) {
      out += text.substring(idx);
      break;
    }
    // 識別子境界チェック（直前文字が識別子文字でない）
    var prev = found > 0 ? text.charAt(found - 1) : "";
    if (prev && /[A-Za-z0-9_]/.test(prev)) {
      out += text.substring(idx, found + funcName.length + 1);
      idx = found + funcName.length + 1;
      continue;
    }
    out += text.substring(idx, found);
    var argStart = found + funcName.length + 1;
    var depth = 1;
    var inString = null; // null | "'" | '"'
    var argEnd = argStart;
    while (argEnd < text.length && depth > 0) {
      var ch = text.charAt(argEnd);
      if (inString) {
        if (ch === inString) inString = null;
      } else if (ch === "'" || ch === '"') {
        inString = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
      argEnd++;
    }
    if (depth !== 0) {
      // パース失敗。原文をそのまま出して終了。
      out += text.substring(found);
      break;
    }
    var argsRaw = text.substring(argStart, argEnd);
    var args = Admin_splitArgs_(argsRaw);
    out += replacer(args);
    idx = argEnd + 1;
  }
  return out;
}

/**
 * トップレベルのカンマで分割。括弧と引用符をエスケープ。
 */
function Admin_splitArgs_(s) {
  var args = [];
  var depth = 0;
  var inString = null;
  var current = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (inString) {
      current += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(") { depth++; current += ch; continue; }
    if (ch === ")") { depth--; current += ch; continue; }
    if (ch === "," && depth === 0) {
      args.push(current.replace(/^\s+|\s+$/g, ""));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.replace(/^\s+|\s+$/g, "") !== "" || args.length > 0) {
    args.push(current.replace(/^\s+|\s+$/g, ""));
  }
  return args;
}

/**
 * フォーム JSON を巡回し、`template` / `computedExpression` / `description` 等の
 * テキストフィールドにある NFB_* 関数呼び出しを書き換える。
 * 書き換えたフォームは Forms_saveForm_ で保存し直す。
 *
 * @return {{processedForms: number, modifiedForms: number, errors: Array}}
 */
function Admin_migrateNfbUdfNamesInForms_() {
  var mapping = Forms_loadFormMapping_ ? Forms_loadFormMapping_() : null;
  if (!mapping || typeof mapping !== "object") {
    return { processedForms: 0, modifiedForms: 0, errors: ["Form mapping unavailable"] };
  }
  var processed = 0;
  var modified = 0;
  var errors = [];

  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    try {
      var form = Forms_getForm_(formId);
      if (!form) continue;
      processed++;

      Admin_currentMigratingFormId_ = formId;
      var changed = Admin_rewriteFormJson_(form);
      if (changed) {
        var saveResult = Forms_saveForm_(form);
        if (saveResult && saveResult.ok) {
          modified++;
          Logger.log("[rename] form=" + formId + " saved");
        } else {
          errors.push({ formId: formId, error: "Save failed" });
        }
      }
    } catch (e) {
      errors.push({ formId: formId, error: String(e) });
    }
  }
  Admin_currentMigratingFormId_ = "";
  return { processedForms: processed, modifiedForms: modified, errors: errors };
}

/**
 * フォームオブジェクトを再帰走査し、文字列フィールドを書き換える。
 * 戻り値は変更があったか。
 */
function Admin_rewriteFormJson_(node) {
  if (node === null || node === undefined) return false;
  var changed = false;
  if (typeof node === "string") return false; // 文字列はオブジェクトキーから書き換える

  if (Object.prototype.toString.call(node) === "[object Array]") {
    for (var i = 0; i < node.length; i++) {
      if (typeof node[i] === "string") {
        var rewritten = Admin_rewriteNfbUdfsInExpressionString_(node[i]);
        if (rewritten !== node[i]) {
          node[i] = rewritten;
          changed = true;
        }
      } else if (node[i] && typeof node[i] === "object") {
        if (Admin_rewriteFormJson_(node[i])) changed = true;
      }
    }
    return changed;
  }

  if (typeof node === "object") {
    for (var k in node) {
      if (!node.hasOwnProperty(k)) continue;
      var v = node[k];
      if (typeof v === "string") {
        var rew = Admin_rewriteNfbUdfsInExpressionString_(v);
        if (rew !== v) {
          node[k] = rew;
          changed = true;
        }
      } else if (v && typeof v === "object") {
        if (Admin_rewriteFormJson_(v)) changed = true;
      }
    }
  }
  return changed;
}

// ============================================================================
// 単一ブレース {...}（旧・元データ形式トークン）→ 連続二重ブレース {{...}}（ビュー形式）への一回限り移行
//
// データ形式 view 統一に伴い、テンプレートトークンは {{...}} のみ有効になった
// （単一ブレース {...} はリテラル文字として出力される）。保存済みフォーム定義の
// テンプレ文字列を {{...}} へ書き換えて従来挙動を保つ。
//
// 注意: 印刷様式の Google Document 本文は外部（Drive）にあり本移行の対象外。
//       管理者は Doc 本文の {...} を手動で {{...}} へ書き換えること。
// ============================================================================

// 移行対象のテンプレ文字列キー（これら以外の文字列フィールドは触らない＝ラベル/説明等の
// リテラル `{` を誤って二重化しないため）。
var ADMIN_TEMPLATE_TEXT_KEYS_ = {
  templateText: true,             // substitution フィールドの式
  fileNameTemplate: true,         // printTemplateAction の出力ファイル名
  gmailTemplateTo: true,
  gmailTemplateCc: true,
  gmailTemplateBcc: true,
  gmailTemplateSubject: true,
  gmailTemplateBody: true,
  driveFolderNameTemplate: true,  // fileUpload のフォルダ名テンプレ
  standardPrintFileNameTemplate: true, // settings 共通の出力ファイル名
};

/**
 * テンプレ文字列のトップレベル単一ブレース `{ expr }` を `{{ expr }}` に書き換える。
 * - 既に `{{ ... }}`（連続二重ブレース）はそのまま（冪等・再実行安全）。
 * - `\{` `\}` エスケープはリテラルとして保持し、ブレース対応の数えからも除外する。
 * - 不均衡な `{` は放置（変換しない）。ネスト `{f({x:1})}` は外側ペアのみ二重化。
 * 依存を持たない自己完結実装（cjs 単体テストでも単独ロードで動く）。
 */
function Admin_rewriteTemplateBraces_(text) {
  if (typeof text !== "string" || text.indexOf("{") < 0) return text;
  var n = text.length;
  var out = "";
  var i = 0;
  while (i < n) {
    var ch = text.charAt(i);
    // \{ \} エスケープはそのまま 2 文字流す（リテラル）。
    if (ch === "\\" && i + 1 < n && (text.charAt(i + 1) === "{" || text.charAt(i + 1) === "}")) {
      out += text.substring(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== "{") { out += ch; i++; continue; }
    // 対応する閉じ } を depth で探す（\{ \} は無視）。
    var depth = 1;
    var j = i + 1;
    var close = -1;
    while (j < n) {
      var c = text.charAt(j);
      if (c === "\\" && j + 1 < n && (text.charAt(j + 1) === "{" || text.charAt(j + 1) === "}")) { j += 2; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { close = j; break; } }
      j++;
    }
    if (close < 0) { out += ch; i++; continue; } // 不均衡 → 放置
    // 既に {{ ... }} なら冪等にそのまま流す。
    if (text.charAt(i + 1) === "{" && close - 1 > i + 1 && text.charAt(close - 1) === "}") {
      out += text.substring(i, close + 1);
      i = close + 1;
      continue;
    }
    out += "{{" + text.substring(i + 1, close) + "}}";
    i = close + 1;
  }
  return out;
}

/**
 * フォームオブジェクトを再帰走査し、ADMIN_TEMPLATE_TEXT_KEYS_ に該当する文字列キーだけ
 * Admin_rewriteTemplateBraces_ で書き換える。戻り値は変更があったか。
 */
function Admin_rewriteFormTemplateBraces_(node) {
  if (!node || typeof node !== "object") return false;
  var changed = false;
  if (Object.prototype.toString.call(node) === "[object Array]") {
    for (var i = 0; i < node.length; i++) {
      if (node[i] && typeof node[i] === "object") {
        if (Admin_rewriteFormTemplateBraces_(node[i])) changed = true;
      }
    }
    return changed;
  }
  for (var k in node) {
    if (!node.hasOwnProperty(k)) continue;
    var v = node[k];
    if (typeof v === "string") {
      if (ADMIN_TEMPLATE_TEXT_KEYS_[k]) {
        var rew = Admin_rewriteTemplateBraces_(v);
        if (rew !== v) { node[k] = rew; changed = true; }
      }
    } else if (v && typeof v === "object") {
      if (Admin_rewriteFormTemplateBraces_(v)) changed = true;
    }
  }
  return changed;
}

/**
 * 全フォーム定義の単一ブレーステンプレを {{...}} へ移行する手動実行エントリ。
 * Admin_migrateNfbUdfNamesInForms_ を踏襲。
 * @return {{processedForms: number, modifiedForms: number, errors: Array}}
 */
function Admin_migrateSingleBraceToDoubleBraceInForms_() {
  var mapping = (typeof Forms_loadFormMapping_ === "function") ? Forms_loadFormMapping_() : null;
  if (!mapping || typeof mapping !== "object") {
    return { processedForms: 0, modifiedForms: 0, errors: ["Form mapping unavailable"] };
  }
  var processed = 0;
  var modified = 0;
  var errors = [];
  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    try {
      var form = Forms_getForm_(formId);
      if (!form) continue;
      processed++;
      var changed = Admin_rewriteFormTemplateBraces_(form);
      if (changed) {
        var saveResult = Forms_saveForm_(form);
        if (saveResult && saveResult.ok) {
          modified++;
          Logger.log("[brace-migrate] form=" + formId + " saved");
        } else {
          errors.push({ formId: formId, error: "Save failed" });
        }
      }
    } catch (e) {
      errors.push({ formId: formId, error: String(e) });
    }
  }
  return { processedForms: processed, modifiedForms: modified, errors: errors };
}

// ============================================================================
// § 中央辞書（マッピングストア）への論理パス folder バックフィル（一回限り・冪等）
//   リンク先の論理パス／fileId 整理（Option C）で、folder をマッピング entry の第一級
//   フィールドに昇格した。既存ストアの folder == null（旧スキーマ由来）のエントリに、
//   Drive 上の json.folder を読んで埋める。
//   非破壊（Property のみ更新）・冪等（folder が既に入っているものは触らない）・再実行安全。
//   ※ Drive ファイルが消失したエントリは folder=null のまま残し、次回「同期」の case③ に委ねる。
// ============================================================================

/**
 * 1 マッピングの folder==null（未バックフィル）エントリを Drive json.folder から埋める。
 * @param {Object} mapping fileId -> entry
 * @return {number} 埋めた件数
 */
function Admin_backfillFolderInMapping_(mapping) {
  var filled = 0;
  if (!mapping || typeof mapping !== "object") return filled;
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var entry = mapping[id];
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.folder === "string") continue; // 既に第一級 folder あり（"" 含む）→ スキップ
    var fileId = Nfb_resolveFileIdFromEntry_(entry);
    if (!fileId) continue;
    var json = StdFolders_readJsonByFileId_(fileId);
    if (json && typeof json === "object" && typeof json.folder !== "undefined") {
      entry.folder = Forms_normalizeFolderPath_(json.folder);
      filled++;
    }
  }
  return filled;
}

/**
 * forms / questions / dashboards の 3 マッピングストアに folder をバックフィルする手動実行エントリ。
 * 同期は停止してから実行することを推奨（読み取り主体だが Property 書込みが走る）。
 * @return {{forms:number, questions:number, dashboards:number}}
 */
function Admin_backfillRegistryFolders_() {
  var result = { forms: 0, questions: 0, dashboards: 0 };

  var formsMapping = Forms_getMapping_();
  result.forms = Admin_backfillFolderInMapping_(formsMapping);
  if (result.forms > 0) Forms_saveMapping_(formsMapping);

  ["questions", "dashboards"].forEach(function(type) {
    var mapping = Analytics_getMapping_(type);
    var n = Admin_backfillFolderInMapping_(mapping);
    if (n > 0) Analytics_saveMapping_(type, mapping);
    result[type] = n;
  });

  Logger.log("[backfill-folder] forms=" + result.forms + " questions=" + result.questions + " dashboards=" + result.dashboards);
  return result;
}

if (typeof module !== "undefined") {
  module.exports = {
    Admin_rewriteNfbUdfsInExpressionString_: Admin_rewriteNfbUdfsInExpressionString_,
    Admin_expandSimpleCallTemplate_: Admin_expandSimpleCallTemplate_,
    Admin_splitArgs_: Admin_splitArgs_,
    Admin_rewriteFormJson_: Admin_rewriteFormJson_,
    Admin_logUdfMigrationWarning_: Admin_logUdfMigrationWarning_,
    Admin_rewriteTemplateBraces_: Admin_rewriteTemplateBraces_,
    Admin_rewriteFormTemplateBraces_: Admin_rewriteFormTemplateBraces_,
    Admin_backfillFolderInMapping_: Admin_backfillFolderInMapping_,
    Admin_backfillRegistryFolders_: Admin_backfillRegistryFolders_,
  };
}
