// =============================================================================
// 外部アクション受信 Web App テンプレートの動作確認用テスト (デプロイ不要)
//
// Builder からの POST は doPost(e) の e.parameter.payload (JSON 文字列) で届く。
// ここではその e を模した擬似オブジェクトをダミー payload で組み立て、
// doPost(e) を直接呼び出して挙動を確認する。
//
// 使い方:
//   1. GAS エディタで関数 testAll を選択して実行 (初回は権限承認)
//   2. 「実行ログ」に各 payload の受信内容と PASS/FAIL が出力される
//   3. testDoPost_search / testDoPost_record / testDoPost_adminStorage を
//      個別に実行すれば、その context だけ確認できる
//
// ダミー payload の形は builder/src/utils/externalActionPost.js の
// buildExternalActionPayload と、list/record の base 構造に合わせてある。
// フロント側を変えたらこちらのダミーも更新すること。
// =============================================================================

// ----- 一括実行 ------------------------------------------------------------
function testAll() {
  var results = [];
  results.push(testDoPost_search());
  results.push(testDoPost_record());
  results.push(testDoPost_adminStorage());
  results.push(testDoPost_missingPayload());
  results.push(testDoPost_badJson());

  var passed = 0;
  for (var i = 0; i < results.length; i++) if (results[i]) passed++;
  Logger.log("==================================================");
  Logger.log("テスト結果: %s / %s PASS", passed, results.length);
  return passed === results.length;
}


// ----- 個別テスト ----------------------------------------------------------
// context === "search": 一覧データを POST したとき成功 HTML が返ること。
function testDoPost_search() {
  var payload = {
    context: "search",
    formId: "form_demo_001",
    formName: "デモ受付フォーム",
    generatedAt: new Date().toISOString(),
    list: {
      // 各列の質問 = ヘッダー階層を "/" で連結した文字列 (列順は rows と一致)
      headers: ["No.", "氏名", "種類/ヒグマ講座", "種類/出前講座"],
      rows: [
        ["1", "山田 太郎", "●", ""],
        ["2", "佐藤 花子", "", "●"],
        // ファイル列は { text, hyperlink } オブジェクトで届くことがある
        ["3", "鈴木 次郎", { text: "添付 2 件", hyperlink: "https://drive.google.com/drive/folders/XXXX" }, ""]
      ],
      rowCount: 3
    }
  };
  return assertDoPostOk_("search", payload);
}

// context === "record": 単一レコードを POST したとき成功 HTML が返ること。
function testDoPost_record() {
  var payload = {
    context: "record",
    formId: "form_demo_001",
    formName: "デモ受付フォーム",
    generatedAt: new Date().toISOString(),
    record: {
      id: "r_01HXXXXXXXXXXXXXXXX_abcd1234",
      no: 12,
      items: [
        { question: "氏名", value: "山田 太郎", type: "text" },
        { question: "講座の種類", value: "ヒグマ講座", type: "radio" },
        // 選択肢配下の項目は親質問・選択肢ラベルも階層に含まれる
        { question: "講座の種類/ヒグマ講座/実施場所", value: "市民ホール", type: "text" },
        { question: "備考", value: "", type: "textarea" }
      ]
    }
  };
  return assertDoPostOk_("record", payload);
}

// 管理者限定ボタン: storage が付与されたとき、その内容がログに出ること。
function testDoPost_adminStorage() {
  var payload = {
    context: "record",
    formId: "form_demo_001",
    formName: "デモ受付フォーム",
    generatedAt: new Date().toISOString(),
    record: {
      id: "r_01HYYYYYYYYYYYYYYYY_efgh5678",
      no: 13,
      items: [
        { question: "氏名", value: "佐藤 花子", type: "text" }
      ]
    },
    storage: {
      spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz",
      sheetName: "Data",
      driveFileUrl: "https://drive.google.com/file/d/ZZZZ",
      userEmail: "admin@example.com"
    }
  };
  return assertDoPostOk_("adminStorage", payload);
}

// payload パラメータが無い異常系: エラー HTML が返ること。
function testDoPost_missingPayload() {
  var e = { parameter: {} };
  var html = doPost(e).getContent();
  var ok = html.indexOf("payload パラメータがありません") !== -1;
  logResult_("missingPayload", ok, html);
  return ok;
}

// payload が壊れた JSON の異常系: エラー HTML が返ること。
function testDoPost_badJson() {
  var e = { parameter: { payload: "{ this is not json " } };
  var html = doPost(e).getContent();
  var ok = html.indexOf("JSON 解析に失敗") !== -1;
  logResult_("badJson", ok, html);
  return ok;
}


// ----- アサーションヘルパ --------------------------------------------------
// payload で doPost を叩き、成功 HTML (「…受信」/「受信完了」) が返れば PASS。
function assertDoPostOk_(name, payload) {
  var e = buildMockPostEvent_(payload);
  var output = doPost(e);
  var html = output.getContent();
  // 成功時は受信内容を表示する画面 (タイトルに「受信」を含む)。エラー画面でないこと。
  var ok = html.indexOf("受信しました") !== -1 &&
    html.indexOf("予期せぬエラー") === -1 && html.indexOf(">エラー<") === -1;
  logResult_(name, ok, html);
  return ok;
}

// 実際の google.script の POST と同じく e.parameter.payload に JSON 文字列を入れる。
// (Builder の隠しフォームは name="payload" の hidden input 1 つだけを送る)
function buildMockPostEvent_(payload) {
  var json = JSON.stringify(payload);
  return {
    parameter: { payload: json },
    parameters: { payload: [json] },
    postData: {
      type: "application/x-www-form-urlencoded",
      length: json.length,
      contents: "payload=" + encodeURIComponent(json)
    },
    contentLength: json.length
  };
}

function logResult_(name, ok, html) {
  Logger.log("--------------------------------------------------");
  Logger.log("[%s] %s", ok ? "PASS" : "FAIL", name);
  if (!ok) {
    Logger.log("返却 HTML (先頭 400 文字): %s", String(html).substring(0, 400));
  }
}
