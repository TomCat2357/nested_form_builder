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
//   3. testDoPost_singleRecord / testDoPost_multiRecords / testDoPost_adminStorage を
//      個別に実行すれば、その起動元パターンだけ確認できる
//
// ダミー payload の形は builder/src/utils/externalActionPost.js の
// buildExternalActionPayload と records 配列 base 構造に合わせてある（起動元に依らず統一形）。
// フロント側を変えたらこちらのダミーも更新すること。
// =============================================================================

// ----- 一括実行 ------------------------------------------------------------
function testAll() {
  var results = [];
  results.push(testDoPost_singleRecord());
  results.push(testDoPost_multiRecords());
  results.push(testDoPost_adminStorage());
  results.push(testDoPost_missingPayload());
  results.push(testDoPost_badJson());
  results.push(testDoPost_probe());

  var passed = 0;
  for (var i = 0; i < results.length; i++) if (results[i]) passed++;
  Logger.log("==================================================");
  Logger.log("テスト結果: %s / %s PASS", passed, results.length);
  return passed === results.length;
}


// ----- 個別テスト ----------------------------------------------------------
// 単一レコード（編集画面 / 検索一覧の単一選択）: recordCount=1 で成功 HTML が返ること。
function testDoPost_singleRecord() {
  var payload = {
    formId: "form_demo_001",
    formName: "デモ受付フォーム",
    generatedAt: new Date().toISOString(),
    recordCount: 1,
    records: [
      {
        id: "r_01HXXXXXXXXXXXXXXXX_abcd1234",
        no: 12,
        items: [
          { question: "氏名", value: "山田 太郎", type: "text" },
          { question: "講座の種類", value: "ヒグマ講座", type: "radio" },
          // 選択肢配下の項目は親質問・選択肢ラベルも階層に含まれる
          { question: "講座の種類/ヒグマ講座/実施場所", value: "市民ホール", type: "text" },
          // fileUpload はファイル参照を items[].files に内包（folderUrl/folderName も）
          {
            question: "添付書類", value: "申請書.pdf", type: "fileUpload",
            files: [{ name: "申請書.pdf", url: "https://drive.google.com/file/d/F1/view", driveFileId: "F1" }],
            folderUrl: "https://drive.google.com/drive/folders/D1", folderName: "申請書類"
          },
          // 子フォーム（formLink）は "親/#No/子質問" 形式で items にインライン展開
          { question: "従事者/#1/氏名", value: "鈴木 次郎", type: "text" },
          { question: "備考", value: "", type: "text" }
        ]
      }
    ]
  };
  return assertDoPostOk_("singleRecord", payload);
}

// 複数レコード（検索一覧の複数選択）: recordCount=N で成功 HTML が返ること。
function testDoPost_multiRecords() {
  var payload = {
    formId: "form_demo_001",
    formName: "デモ受付フォーム",
    generatedAt: new Date().toISOString(),
    recordCount: 2,
    records: [
      { id: "r1", no: 1, items: [{ question: "氏名", value: "山田 太郎", type: "text" }] },
      { id: "r2", no: 2, items: [{ question: "氏名", value: "佐藤 花子", type: "text" }] }
    ]
  };
  return assertDoPostOk_("multiRecords", payload);
}

// 管理者限定ボタン: storage が付与されたとき、その内容がログに出ること。
function testDoPost_adminStorage() {
  var payload = {
    formId: "form_demo_001",
    formName: "デモ受付フォーム",
    generatedAt: new Date().toISOString(),
    recordCount: 1,
    records: [
      {
        id: "r_01HYYYYYYYYYYYYYYYY_efgh5678",
        no: 13,
        items: [
          { question: "氏名", value: "佐藤 花子", type: "text" }
        ]
      }
    ],
    storage: {
      spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz",
      sheetName: "Data",
      driveFileUrl: "https://drive.google.com/file/d/ZZZZ",
      userEmail: "admin@example.com",
      childSpreadsheetId: "1ChildSsXXXXXXXXXXXXXXXXXXXX",
      childSpreadsheetUrl: "https://docs.google.com/spreadsheets/d/1ChildSsXXXXXXXXXXXXXXXXXXXX",
      childSheetName: "従事者"
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


// 誤送信防止ハンドシェイク（プローブ）: Script Property NFB_EXT_ACTION_SECRET を
// 設定した状態で nfbProbe を投げると、HMAC(nonce) を含む署名 JSON が返り、
// 業務処理（handleRecords_）には入らないこと。未設定なら nfbExternalAction:false。
function testDoPost_probe() {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty("NFB_EXT_ACTION_SECRET");
  var ok = true;
  try {
    // (1) シークレット設定あり: 署名が返る。
    props.setProperty("NFB_EXT_ACTION_SECRET", "TEST_SECRET");
    var e1 = { parameter: { nfbRelay: "1", payload: JSON.stringify({ nfbProbe: "1", nonce: "N1" }) } };
    var d1 = JSON.parse(doPost(e1).getContent());
    var expected = Recv_hmacHex_("N1", "TEST_SECRET");
    var pass1 = d1.ok === true && d1.nfbExternalAction === true && d1.signature === expected;

    // (2) シークレット未設定: nfbExternalAction:false。
    props.deleteProperty("NFB_EXT_ACTION_SECRET");
    var d2 = JSON.parse(doPost(e1).getContent());
    var pass2 = d2.ok === true && d2.nfbExternalAction === false && !d2.signature;

    ok = pass1 && pass2;
    logResult_("probe", ok, JSON.stringify({ withSecret: d1, withoutSecret: d2 }));
  } finally {
    if (saved == null) props.deleteProperty("NFB_EXT_ACTION_SECRET");
    else props.setProperty("NFB_EXT_ACTION_SECRET", saved);
  }
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
