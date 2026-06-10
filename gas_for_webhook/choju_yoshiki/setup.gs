// =============================================================================
// setup.gs — 一次セットアップ（GAS エディタから手動実行する）
//
// 手順:
//   1. form_data/鳥獣保護管理法様式.xlsx を Drive にアップロード →
//      「ファイル > Google スプレッドシートとして保存」で変換し、ファイル ID を控える
//   2. 出力先フォルダを Drive に作成し、フォルダ ID を控える
//   3. 下の Cho_registerSettings の引数を書き換えて実行（Script Properties に保存）
//   4. Cho_setupCleanTemplate を実行（入力専用シートの削除 + 全数式の消去。冪等）
//      実行ログにシートごとの消去セル数が出るので、scripts/out/formulas.tsv の
//      件数と突き合わせて消し漏れがないことを確認する
// =============================================================================

// 引数を直接書き換えて GAS エディタから実行する（実行後は引数を消してよい）。
// accessKey は webhook URL の ?k= と照合する任意の合言葉（空文字ならゲート無効）。
function Cho_registerSettings(templateFileId, outputFolderId, accessKey) {
  if (!templateFileId || !outputFolderId) {
    throw new Error("templateFileId と outputFolderId を指定してください。");
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty(CHO_PROP_TEMPLATE_, String(templateFileId));
  props.setProperty(CHO_PROP_FOLDER_, String(outputFolderId));
  props.setProperty(CHO_PROP_KEY_, String(accessKey || ""));
  Logger.log("登録しました: template=%s / folder=%s / accessKey=%s",
    templateFileId, outputFolderId, accessKey ? "(設定あり)" : "(なし)");
}

// テンプレートの清掃: 入力専用シート（Sheet1・申請内容）を削除し、残る全シートの
// 数式セルを clearContent する（書式・結合・罫線・表示形式は保持される）。冪等。
function Cho_setupCleanTemplate() {
  var templateId = PropertiesService.getScriptProperties().getProperty(CHO_PROP_TEMPLATE_);
  if (!templateId) {
    throw new Error("先に Cho_registerSettings を実行してください。");
  }
  var ss = SpreadsheetApp.openById(templateId);

  for (var d = 0; d < CHO_SHEETS_TO_DELETE_.length; d++) {
    var doomed = ss.getSheetByName(CHO_SHEETS_TO_DELETE_[d]);
    if (doomed) {
      ss.deleteSheet(doomed);
      Logger.log("シート削除: %s", CHO_SHEETS_TO_DELETE_[d]);
    }
  }

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var range = sheet.getDataRange();
    var formulas = range.getFormulas();
    var cleared = 0;
    for (var r = 0; r < formulas.length; r++) {
      // 連続する数式セルをまとめて clearContent する（行ごとの run-length）
      var c = 0;
      while (c < formulas[r].length) {
        if (formulas[r][c]) {
          var start = c;
          while (c < formulas[r].length && formulas[r][c]) c++;
          sheet.getRange(r + 1, start + 1, 1, c - start).clearContent();
          cleared += c - start;
        } else {
          c++;
        }
      }
    }
    Logger.log("数式消去: %s … %s セル", sheet.getName(), cleared);
  }
  SpreadsheetApp.flush();
  Logger.log("テンプレート清掃が完了しました。");
}
