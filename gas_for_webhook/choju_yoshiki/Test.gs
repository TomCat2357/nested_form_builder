// =============================================================================
// Test.gs — デプロイ不要の動作確認（GAS エディタから testAll を実行してログを見る）
//
//   testModel_golden      … ゴールデン payload のモデル組み立て（純ロジックのみ）
//   testModel_multiMethod … 従事者×捕獲方法の展開（4 ブロック・2 番目以降個人欄空白）
//   testFill_golden       … doPost を通して実際に様式を生成（テンプレ設定済みのときのみ）
//   testDoPost_missingPayload / testDoPost_badJson … 異常系
// =============================================================================

function testAll() {
  var results = [];
  results.push(testModel_golden());
  results.push(testModel_multiMethod());
  results.push(testDoPost_missingPayload());
  results.push(testDoPost_badJson());
  results.push(testFill_golden());

  var passed = 0;
  for (var i = 0; i < results.length; i++) if (results[i]) passed++;
  Logger.log("==================================================");
  Logger.log("テスト結果: %s / %s PASS", passed, results.length);
  return passed === results.length;
}

// ----- モデル組み立て（ゴールデン） -----------------------------------------
function testModel_golden() {
  var model = Cho_buildModel_(Cho_buildGoldenPayload_());
  var errors = [];
  function expect(label, actual, expected) {
    var a = actual instanceof Date ? Utilities.formatDate(actual, "Asia/Tokyo", "yyyy-MM-dd") : actual;
    if (a !== expected) errors.push(label + ": got=" + a + " want=" + expected);
  }
  expect("applicantType", model.applicantType, "個人");
  expect("certOrRequest", model.certOrRequest, "依頼書");
  expect("workerCount", model.workerCount, 2);
  expect("applicantNameComposed", model.applicantNameComposed, "秋　はじめ(ほか1名)");
  expect("applicantAddress", model.applicantAddress, "札幌市北区あいの里X条X丁目X-X");
  expect("speciesList.length", model.speciesList.length, 1);
  expect("species name", model.speciesList[0].name, "キツネ");
  expect("species count", model.speciesList[0].count, 10);
  expect("species unit", model.speciesList[0].unit, "頭");
  expect("method1", model.method1, "くくりわな");
  expect("disposal1", model.disposal1, "焼却");
  expect("hasTrapMethod", model.hasTrapMethod, true);
  expect("area7Flag", model.area7Flag, "該当あり");
  expect("area7Detail", model.area7Detail, "公道");
  expect("periodStart", model.periodStart, "2026-06-01");
  expect("periodEnd", model.periodEnd, "2026-06-30");
  expect("periodDaysText", model.periodDaysText, "30日間");
  expect("requesterName", model.requesterName, "札幌市長　秋元　克広");
  expect("damageStatus", model.damageStatus, "住民へのつきまとい等");
  expect("permitNoFull", model.permitNoFull, "第8-81号");
  expect("permitDocNo", model.permitDocNo, "札環対許可第8-81号");
  expect("workerCertNo1", model.workerCertNo1, "第8-81-1号");
  expect("certNoRangeText", model.certNoRangeText, "(許可証番号　第8-81-1号～第8-81-2号)");
  expect("licenseNote", model.licenseNote, CHO_NOTE_SEE_ROSTER_);
  expect("registrationNote", model.registrationNote, "");
  expect("gunPermitNote", model.gunPermitNote, "");
  expect("reviewClassText", model.reviewClassText, CHO_REVIEW_CLASS_PROXY_);

  // 名簿展開: 2 名 × 各 1 方法 = 2 ブロック
  expect("rosterEntries.length", model.rosterEntries.length, 2);
  var e1 = model.rosterEntries[0];
  expect("e1.certNo", e1.certNo, "第8-81-1号");
  expect("e1.includePersonal", e1.includePersonal, true);
  expect("e1.worker.name", e1.worker.name, "秋　はじめ");
  expect("e1.method.lic.type", e1.method.lic.type, "わな猟");
  expect("e1.method.lic.authority", e1.method.lic.authority, "北海道知事");
  expect("e1.method.lic.no", e1.method.lic.no, "石狩第0000号");
  expect("e1.method.tools", e1.method.tools.join(","), "くくりわな");
  expect("e1.worker.species[0].count", e1.worker.species[0].count, 5);
  var e2 = model.rosterEntries[1];
  expect("e2.certNo", e2.certNo, "第8-81-2号");
  expect("e2.method.lic.no", e2.method.lic.no, "石狩第0001号");

  logResult_("model_golden", errors.length === 0, errors.join(" / "));
  return errors.length === 0;
}

// ----- 従事者 × 捕獲方法の展開 ----------------------------------------------
function testModel_multiMethod() {
  var payload = Cho_buildGoldenPayload_();
  // 3 人目（わな猟 + 空気銃 + 銃 2 丁）を追加
  var extra = Cho_buildMultiMethodWorkerItems_("従事者情報/#3/");
  payload.record.items = payload.record.items.concat(extra);

  var model = Cho_buildModel_(payload);
  var errors = [];
  function expect(label, actual, expected) {
    if (actual !== expected) errors.push(label + ": got=" + actual + " want=" + expected);
  }
  expect("workerCount", model.workerCount, 3);
  // 1 + 1 + (1 + 1 + 2) = 6 ブロック
  expect("rosterEntries.length", model.rosterEntries.length, 6);

  var w3entries = [];
  for (var i = 0; i < model.rosterEntries.length; i++) {
    if (model.rosterEntries[i].worker.name === "冬村　多才") w3entries.push(model.rosterEntries[i]);
  }
  expect("w3 entries", w3entries.length, 4);
  expect("w3[0].includePersonal", w3entries[0].includePersonal, true);
  expect("w3[1].includePersonal", w3entries[1].includePersonal, false);
  expect("w3[1].certNo (空欄)", w3entries[1].certNo, "");
  // わな猟ブロック: 用具 2 つ・わな猟免許・狩猟者登録あり
  expect("w3 trap tools", w3entries[0].method.tools.join(","), "はこわな,くくりわな");
  expect("w3 trap reg.no", w3entries[0].method.reg.no, "わ第222号");
  // 空気銃ブロック: 第二種銃猟 + 所持許可
  expect("w3 air lic.type", w3entries[1].method.lic.type, "第二種銃猟");
  expect("w3 air poss.no", w3entries[1].method.poss.no, "空第333号");
  expect("w3 air gunKind", w3entries[1].method.gunKind, "空気銃");
  // 銃 2 丁 → 2 ブロック（所持許可が別番号、免許は同一）
  expect("w3 gun1 poss.no", w3entries[2].method.poss.no, "散第555号");
  expect("w3 gun2 poss.no", w3entries[3].method.poss.no, "ラ第666号");
  expect("w3 gun1 lic.no", w3entries[2].method.lic.no, "石狩第7777号");
  expect("w3 gun2 lic.no", w3entries[3].method.lic.no, "石狩第7777号");
  expect("w3 gun1 tools", w3entries[2].method.tools.join(","), "銃(散弾銃)");
  expect("w3 gun2 gunKind", w3entries[3].method.gunKind, "ライフル銃");
  // 銃器使用ありなので申請書 E42 が立つ
  expect("gunPermitNote", model.gunPermitNote, CHO_NOTE_SEE_ROSTER_);
  expect("registrationNote", model.registrationNote, CHO_NOTE_SEE_ROSTER_);

  logResult_("model_multiMethod", errors.length === 0, errors.join(" / "));
  return errors.length === 0;
}

// ----- 実際に様式を生成（テンプレ設定済み環境のみ。未設定なら SKIP=PASS） -----
function testFill_golden() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(CHO_PROP_TEMPLATE_) || !props.getProperty(CHO_PROP_FOLDER_)) {
    Logger.log("[SKIP] fill_golden: テンプレート未設定のためスキップ（Cho_registerSettings 実行後に再実行）");
    return true;
  }
  var html = doPost(buildMockPostEvent_(Cho_buildGoldenPayload_())).getContent();
  var ok = html.indexOf("様式を作成しました") !== -1;
  logResult_("fill_golden", ok, html);
  if (ok) {
    var m = html.match(/href="([^"]+)"/);
    Logger.log("生成された様式: %s", m ? m[1].replace(/&amp;/g, "&") : "(リンク抽出失敗)");
  }
  return ok;
}

// ----- 異常系（gas_for_webhook/template/Test.gs と同じ） ---------------------
function testDoPost_missingPayload() {
  var html = doPost({ parameter: {} }).getContent();
  var ok = html.indexOf("payload パラメータがありません") !== -1;
  logResult_("missingPayload", ok, html);
  return ok;
}

function testDoPost_badJson() {
  var html = doPost({ parameter: { payload: "{ this is not json " } }).getContent();
  var ok = html.indexOf("JSON 解析に失敗") !== -1;
  logResult_("badJson", ok, html);
  return ok;
}

// ----- ヘルパ（template/Test.gs より） ---------------------------------------
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

function logResult_(name, ok, detail) {
  Logger.log("--------------------------------------------------");
  Logger.log("[%s] %s", ok ? "PASS" : "FAIL", name);
  if (!ok) {
    Logger.log("詳細 (先頭 600 文字): %s", String(detail).substring(0, 600));
  }
}
