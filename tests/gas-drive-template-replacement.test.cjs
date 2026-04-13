const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createTextElement(initialText) {
  let text = initialText;
  return {
    editAsText() {
      return this;
    },
    getText() {
      return text;
    },
    replaceText(pattern, replacement) {
      text = text.replace(new RegExp(pattern, "g"), replacement);
      return this;
    },
  };
}

function createContainer(children) {
  return {
    getText() {
      return children.map((c) => (typeof c.getText === "function" ? c.getText() : "")).join("\n");
    },
    replaceText(pattern, replacement) {
      children.forEach((c) => {
        if (typeof c.replaceText === "function") c.replaceText(pattern, replacement);
      });
      return this;
    },
    getNumChildren() {
      return children.length;
    },
    getChild(index) {
      return children[index];
    },
  };
}

function loadGasContext() {
  const formatLookup = {
    "yyyy-MM-dd HH:mm:ss": "2026-04-04 10:20:30",
    "yyyy-MM-dd": "2026-04-04",
    "HH:mm:ss": "10:20:30",
    yyyy: "2026",
    MM: "04",
    dd: "04",
    HH: "10",
    mm: "20",
    ss: "30",
  };
  const context = {
    console,
    JSON,
    NFB_RECORD_TEMP_FOLDER_PREFIX: "NFB_RECORD_TEMP_",
    Session: {
      getScriptTimeZone() {
        return "Asia/Tokyo";
      },
    },
    Utilities: {
      formatDate(_date, _tz, format) {
        return formatLookup[format] || format;
      },
      getUuid() {
        return "uuid-test-1234";
      },
    },
    nfbSafeCall_(fn) {
      return fn();
    },
    nfbErrorToString_(error) {
      return error && error.message ? error.message : String(error);
    },
    Forms_parseGoogleDriveUrl_(url) {
      const match = String(url).match(/\/d\/([^/]+)/);
      return { type: "file", id: match ? match[1] : "" };
    },
  };

  vm.createContext(context);
  const projectRoot = path.join(__dirname, "..");
  const gasDir = path.join(projectRoot, "gas");
  const driveFiles = [
    "driveTemplate.gs",
    "drivePrintDocument.gs",
    "driveFolder.gs",
    "driveOutput.gs",
    "driveFile.gs",
  ];
  for (const fileName of driveFiles) {
    const filePath = path.join(gasDir, fileName);
    const code = fs.readFileSync(filePath, "utf8");
    vm.runInContext(code, context, { filename: filePath });
  }
  return context;
}

test("nfbCreateGoogleDocumentFromTemplate は既知プレースホルダーだけ置換し同名ファイルを上書きする", () => {
  const gas = loadGasContext();
  const fixedNow = new Date("2026-04-04T10:20:30+09:00");
  const existingFile = {
    trashed: false,
    setTrashed(value) {
      this.trashed = value;
    },
  };
  const folder = {
    getUrl() {
      return "https://drive.google.com/drive/folders/folder123";
    },
    getFilesByName(fileName) {
      let used = false;
      return {
        hasNext() {
          return !used && fileName === "rec001_山田 太郎";
        },
        next() {
          used = true;
          return existingFile;
        },
      };
    },
  };
  const bodyText = createTextElement("本文 {@氏名} {@_id} {YYYY-MM-DD} {UNKNOWN}");
  const tableCellText = createTextElement("セル {@部署}");
  const headerText = createTextElement("header {@氏名}");
  const footerText = createTextElement("footer {@_id}");
  const doc = {
    saved: false,
    getBody() {
      return createContainer([bodyText, createContainer([tableCellText])]);
    },
    getHeader() {
      return createContainer([headerText]);
    },
    getFooter() {
      return createContainer([footerText]);
    },
    saveAndClose() {
      this.saved = true;
    },
  };
  const copiedFile = {
    getId() {
      return "copied123";
    },
    getUrl() {
      return "https://docs.google.com/document/d/copied123/edit";
    },
    getName() {
      return "rec001_山田 太郎";
    },
  };
  const sourceFile = {
    getName() {
      return "テンプレート";
    },
    makeCopy(fileName, targetFolder) {
      assert.equal(fileName, "rec001_山田 太郎");
      assert.equal(targetFolder, folder);
      return copiedFile;
    },
  };

  gas.DriveApp = {
    getFileById(fileId) {
      assert.equal(fileId, "template123");
      return sourceFile;
    },
  };
  gas.DocumentApp = {
    openById(fileId) {
      assert.equal(fileId, "copied123");
      return doc;
    },
  };
  gas.nfbResolveUploadFolder_ = function() {
    return { folder, autoCreated: true };
  };
  gas.nfbBuildDriveTemplateContext_ = function(driveSettings) {
    return {
      responses: driveSettings.responses || {},
      fieldLabels: driveSettings.fieldLabels || {},
      fieldValues: driveSettings.fieldValues || {},
      recordId: driveSettings.recordId || "",
      now: fixedNow,
    };
  };

  const result = gas.nfbCreateGoogleDocumentFromTemplate({
    sourceUrl: "https://docs.google.com/document/d/template123/edit",
    fileNameTemplate: "{@_id}_{@氏名}",
    driveSettings: {
      recordId: "rec001",
      responses: {
        name: "山田太郎(生データ)",
        dept: "営業",
      },
      fieldLabels: {
        name: "氏名",
        dept: "部署",
      },
      fieldValues: {
        name: "山田 太郎",
        dept: "営業一課",
      },
    },
  });

  assert.equal(existingFile.trashed, true);
  assert.equal(bodyText.getText(), "本文 山田 太郎 rec001  ");
  assert.equal(tableCellText.getText(), "セル 営業一課");
  assert.equal(headerText.getText(), "header 山田 太郎");
  assert.equal(footerText.getText(), "footer rec001");
  assert.equal(doc.saved, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: true,
    fileUrl: "https://docs.google.com/document/d/copied123/edit",
    fileName: "rec001_山田 太郎",
    fileId: "copied123",
    folderUrl: "https://drive.google.com/drive/folders/folder123",
    autoCreated: true,
  });
});

test("nfbResolveRecordOutputFileNameTemplate_ は標準ファイル名未設定時に既定値へフォールバックする", () => {
  const gas = loadGasContext();

  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: {} },
      { outputType: "googleDoc", fileNameTemplate: "" },
      "googleDoc",
    ),
    "{@_id}_{@_NOW|time:YYYY-MM-DD}",
  );

  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: { standardPrintFileNameTemplate: "   " } },
      { outputType: "pdf", fileNameTemplate: "" },
      "pdf",
    ),
    "{@_id}_{@_NOW|time:YYYY-MM-DD}",
  );

  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: {} },
      { outputType: "gmail", fileNameTemplate: "", gmailAttachPdf: true },
      "gmail",
    ),
    "{@_id}_{@_NOW|time:YYYY-MM-DD}",
  );
});
test("nfbFindDriveFileInFolder は PDF 出力時に .pdf を補完して検索する", () => {
  const gas = loadGasContext();
  let searchedName = "";
  const foundFile = {
    getUrl() {
      return "https://drive.google.com/file/d/pdf001/view";
    },
    getName() {
      return "rec001_output.pdf";
    },
    getId() {
      return "pdf001";
    },
  };
  const folder = {
    getFilesByName(fileName) {
      searchedName = fileName;
      let used = false;
      return {
        hasNext() {
          return !used && fileName === "rec001_output.pdf";
        },
        next() {
          used = true;
          return foundFile;
        },
      };
    },
    getUrl() {
      return "https://drive.google.com/drive/folders/folder123";
    },
  };

  gas.nfbBuildDriveTemplateContext_ = () => ({ recordId: "rec001" });
  gas.nfbResolveTemplate_ = () => "rec001_output";
  gas.nfbResolveUploadFolder_ = () => ({ folder });

  const result = gas.nfbFindDriveFileInFolder({
    fileNameTemplate: "{@_id}_output",
    outputType: "pdf",
    driveSettings: { recordId: "rec001" },
  });

  assert.equal(searchedName, "rec001_output.pdf");
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.fileName, "rec001_output.pdf");
});

test("nfbResolveUploadFolder_ は自動作成した一時フォルダ名をテンプレートで更新する", () => {
  const gas = loadGasContext();
  const createdFolder = {
    name: "__NFB_RECORD_TEMP__rec001_temp",
    getName() {
      return this.name;
    },
    setName(nextName) {
      this.name = nextName;
    },
    getUrl() {
      return "https://drive.google.com/drive/folders/temp001";
    },
  };
  const rootFolder = {
    createFolder(name) {
      createdFolder.name = name;
      return createdFolder;
    },
  };

  gas.nfbResolveRootFolder_ = () => rootFolder;
  gas.nfbResolveTemplate_ = (template, context) => `${template}:${context.recordId}`;

  const result = gas.nfbResolveUploadFolder_({
    recordId: "rec001",
    folderNameTemplate: "案件_{@_id}",
  });

  assert.equal(result.autoCreated, true);
  assert.equal(result.folder, createdFolder);
  assert.equal(createdFolder.getName(), "案件_{@_id}:rec001");
});

test("nfbResolveUploadFolder_ は通常フォルダをテンプレートで改名しない", () => {
  const gas = loadGasContext();
  const folder = {
    name: "通常フォルダ",
    getName() {
      return this.name;
    },
    setName(nextName) {
      this.name = nextName;
    },
    getUrl() {
      return "https://drive.google.com/drive/folders/fixed001";
    },
  };

  gas.nfbResolveFolderFromInput_ = () => folder;
  gas.nfbResolveTemplate_ = () => "改名されない";

  const result = gas.nfbResolveUploadFolder_({
    folderUrl: "https://drive.google.com/drive/folders/fixed001",
    folderNameTemplate: "案件_{@_id}",
    recordId: "rec001",
  });

  assert.equal(result.autoCreated, false);
  assert.equal(result.folder, folder);
  assert.equal(folder.getName(), "通常フォルダ");
});

// ---------------------------------------------------------------------------
// Pipe transformer tests
// ---------------------------------------------------------------------------

test("パイプ変換: left/right/mid で文字列を切り出す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f1: "備考" },
    fieldValues: { f1: "あいうえお" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@備考|left:3}", ctx), "あいう");
  assert.equal(gas.nfbResolveTemplate_("{@備考|right:2}", ctx), "えお");
  assert.equal(gas.nfbResolveTemplate_("{@備考|mid:1,3}", ctx), "いうえ");
});

test("パイプ変換: date フォーマットで日付フィールドを整形", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { dob: "生年月日" },
    fieldValues: { dob: "2000-01-15" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@生年月日|time:YYYY}", ctx), "2000");
  assert.equal(gas.nfbResolveTemplate_("{@生年月日|time:YYYY/MM/DD}", ctx), "2000/01/15");
  assert.equal(gas.nfbResolveTemplate_("{@生年月日|time:YYYY年M月D日}", ctx), "2000年1月15日");
  assert.equal(gas.nfbResolveTemplate_("{@生年月日|time:YY}", ctx), "00");
});

test("パイプ変換: date で和暦（元号）に変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { dob: "生年月日" },
    fieldValues: { dob: "2000-01-15" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@生年月日|time:gg}", ctx), "平成");
  assert.equal(gas.nfbResolveTemplate_("{@生年月日|time:gge年}", ctx), "平成12年");
  assert.equal(gas.nfbResolveTemplate_("{@生年月日|time:gge年M月D日}", ctx), "平成12年1月15日");
});

test("パイプ変換: 令和の日付を和暦に変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { d: "入社日" },
    fieldValues: { d: "2026-04-01" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@入社日|time:gge年}", ctx), "令和8年");
});

test("パイプ変換: チェーン（複数パイプ）が左から順に適用される", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { dob: "生年月日" },
    fieldValues: { dob: "2000-01-15" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // date で年を取り出し → pad で6桁ゼロ埋め
  assert.equal(gas.nfbResolveTemplate_("{@生年月日|time:YYYY|pad:6,0}", ctx), "002000");
});

test("パイプ変換: upper/lower/trim", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { code: "コード" },
    fieldValues: { code: "  aBcD  " },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@コード|trim}", ctx), "aBcD");
  assert.equal(gas.nfbResolveTemplate_("{@コード|trim|upper}", ctx), "ABCD");
  assert.equal(gas.nfbResolveTemplate_("{@コード|trim|lower}", ctx), "abcd");
});

test("パイプ変換: default で空値にフォールバック", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { tel: "電話" },
    fieldValues: { tel: "" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@電話|default:未入力}", ctx), "未入力");
});

test("パイプ変換: replace で文字列を全置換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { addr: "住所" },
    fieldValues: { addr: "東京都-新宿区-西新宿" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@住所|replace:-,/}", ctx), "東京都/新宿区/西新宿");
});

test("パイプ変換: 予約トークン + パイプ", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|time:YYYY|left:2}", ctx), "20");
});

test("パイプ変換: パース不能な日付はそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "自由入力" },
    fieldValues: { f: "abc" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@自由入力|time:YYYY}", ctx), "abc");
});

test("パイプ変換: 不明な変換名はスルーされる", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "名前" },
    fieldValues: { f: "山田" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@名前|unknown:5}", ctx), "山田");
});

test("パイプ変換: Google Doc テンプレート置換でもパイプが動作する", () => {
  const gas = loadGasContext();
  const fixedNow = new Date("2026-04-04T10:20:30+09:00");
  const bodyText = createTextElement("生年月日: {@生年月日|time:gge年M月D日}");
  const headerText = createTextElement("{@氏名|left:2} 様");
  const doc = {
    getBody() { return createContainer([bodyText]); },
    getHeader() { return createContainer([headerText]); },
    getFooter() { return null; },
  };
  const ctx = {
    responses: {},
    fieldLabels: { name: "氏名", dob: "生年月日" },
    fieldValues: { name: "山田太郎", dob: "2000-01-15" },
    now: fixedNow,
  };
  gas.nfbApplyTemplateReplacementsToGoogleDocument_(doc, ctx, {});
  assert.equal(bodyText.getText(), "生年月日: 平成12年1月15日");
  assert.equal(headerText.getText(), "山田 様");
});

// ---------------------------------------------------------------------------
// 新規変換器テスト
// ---------------------------------------------------------------------------

test("パイプ変換: date で曜日を表示（ddd / dddd）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { d: "入社日" },
    fieldValues: { d: "2026-04-04" }, // Saturday
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@入社日|time:YYYY/MM/DD(ddd)}", ctx), "2026/04/04(土)");
  assert.equal(gas.nfbResolveTemplate_("{@入社日|time:dddd}", ctx), "土曜日");
  // Monday
  ctx.fieldValues.d = "2026-04-06";
  assert.equal(gas.nfbResolveTemplate_("{@入社日|time:ddd}", ctx), "月");
  assert.equal(gas.nfbResolveTemplate_("{@入社日|time:dddd}", ctx), "月曜日");
});

test("パイプ変換: time で時刻を整形", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { t: "受付時間" },
    fieldValues: { t: "14:30" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@受付時間|time:HH時mm分}", ctx), "14時30分");
  assert.equal(gas.nfbResolveTemplate_("{@受付時間|time:H:m}", ctx), "14:30");
});

test("パイプ変換: time で秒付き時刻を整形", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { t: "時刻" },
    fieldValues: { t: "9:05:07" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@時刻|time:HH:mm:ss}", ctx), "09:05:07");
  assert.equal(gas.nfbResolveTemplate_("{@時刻|time:H時m分s秒}", ctx), "9時5分7秒");
});

test("パイプ変換: time でdatetime文字列から時刻を抽出", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { dt: "日時" },
    fieldValues: { dt: "2026-04-04 14:30:00" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@日時|time:HH:mm}", ctx), "14:30");
});

test("パイプ変換: time でパース不能な値はそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { t: "自由入力" },
    fieldValues: { t: "abc" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@自由入力|time:HH:mm}", ctx), "abc");
});

test("パイプ変換: match で正規表現抽出", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "メール" },
    fieldValues: { f: "user@example.com" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // Full match (group 0)
  assert.equal(gas.nfbResolveTemplate_("{@メール|match:[^@]+}", ctx), "user");
  // With group
  assert.equal(gas.nfbResolveTemplate_("{@メール|match:(.+)@(.+),1}", ctx), "user");
  assert.equal(gas.nfbResolveTemplate_("{@メール|match:(.+)@(.+),2}", ctx), "example.com");
});

test("パイプ変換: match でマッチしない場合は空文字", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "abcdef" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@テキスト|match:\\d+}", ctx), "");
});

test("パイプ変換: match で不正な正規表現は元の値を返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "abc" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@テキスト|match:[invalid}", ctx), "abc");
});

test("パイプ変換: number で数値フォーマット", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "1234567" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@金額|number:#,##0}", ctx), "1,234,567");
  ctx.fieldValues.n = "3.14159";
  assert.equal(gas.nfbResolveTemplate_("{@金額|number:0.00}", ctx), "3.14");
  ctx.fieldValues.n = "1234567.89";
  assert.equal(gas.nfbResolveTemplate_("{@金額|number:#,##0.00}", ctx), "1,234,567.89");
});

test("パイプ変換: number で接尾辞付きフォーマット", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "1234567" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@金額|number:#,##0円}", ctx), "1,234,567円");
});

test("パイプ変換: number で非数値はそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "abc" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@金額|number:#,##0}", ctx), "abc");
});

test("パイプ変換: if で == 等値比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { g: "性別" },
    fieldValues: { g: "男" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 条件一致 → パイプ入力値（性別の値）を返す
  assert.equal(gas.nfbResolveTemplate_("{@性別|if:@性別==男,Ms.}", ctx), "男");
  // 条件不一致 → else値
  ctx.fieldValues.g = "女";
  assert.equal(gas.nfbResolveTemplate_("{@性別|if:@性別==男,Ms.}", ctx), "Ms.");
});

test("パイプ変換: if で truthiness 判定", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "備考" },
    fieldValues: { f: "あり" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 値あり → パイプ入力値を返す
  assert.equal(gas.nfbResolveTemplate_("{@備考|if:@備考,なし}", ctx), "あり");
  // 値なし → else値
  ctx.fieldValues.f = "";
  assert.equal(gas.nfbResolveTemplate_("{@備考|if:@備考,なし}", ctx), "なし");
});

test("パイプ変換: map で値をマッピング", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { e: "評価" },
    fieldValues: { e: "A" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@評価|map:A=優;B=良;C=可;*=不明}", ctx), "優");
  ctx.fieldValues.e = "C";
  assert.equal(gas.nfbResolveTemplate_("{@評価|map:A=優;B=良;C=可;*=不明}", ctx), "可");
  ctx.fieldValues.e = "Z";
  assert.equal(gas.nfbResolveTemplate_("{@評価|map:A=優;B=良;C=可;*=不明}", ctx), "不明");
});

test("パイプ変換: map でデフォルトなし・マッチなしは元の値", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { e: "評価" },
    fieldValues: { e: "Z" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@評価|map:A=優;B=良}", ctx), "Z");
});

test("パイプ変換: kana でひらがなをカタカナに変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "名前" },
    fieldValues: { f: "やまだ たろう" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@名前|kana}", ctx), "ヤマダ タロウ");
});

test("パイプ変換: zen で半角を全角に変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "ABC 123" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@テキスト|zen}", ctx), "\uFF21\uFF22\uFF23\u3000\uFF11\uFF12\uFF13");
});

test("パイプ変換: zen で半角カナを全角カナに変換（濁音含む）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "カナ" },
    fieldValues: { f: "\uFF76\uFF9E\uFF77\uFF9E" }, // ｶﾞｷﾞ
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@カナ|zen}", ctx), "ガギ");
});

test("パイプ変換: han で全角を半角に変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "\uFF21\uFF22\uFF23\u3000\uFF11\uFF12\uFF13" }, // ＡＢＣ　１２３
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@テキスト|han}", ctx), "ABC 123");
});

test("パイプ変換: han で全角カナを半角カナに変換（濁音含む）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "カナ" },
    fieldValues: { f: "ガギ" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@カナ|han}", ctx), "\uFF76\uFF9E\uFF77\uFF9E"); // ｶﾞｷﾞ
});

test("パイプ変換: エスケープ \\| でリテラルパイプを使用", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "A-B-C" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // replace:-,| should replace - with literal |
  assert.equal(gas.nfbResolveTemplate_("{@テキスト|replace:-,\\|}", ctx), "A|B|C");
});

test("パイプ変換: 新規変換器のチェーン", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "名前" },
    fieldValues: { f: "やまだ" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // kana → han chain
  assert.equal(gas.nfbResolveTemplate_("{@名前|kana|han}", ctx), "\uFF94\uFF8F\uFF80\uFF9E"); // ﾔﾏﾀﾞ
});

// ---------------------------------------------------------------------------
// {@_NOW} reserved token tests
// ---------------------------------------------------------------------------

test("予約トークン: {@_NOW} が YYYY-MM-DD HH:mm:ss を返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@_NOW}", ctx), "2026-04-04 10:20:30");
});

test("予約トークン: {@_NOW|time:...} で日付フォーマット", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|time:YYYY年M月D日}", ctx), "2026年4月4日");
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|time:YYYY/MM/DD}", ctx), "2026/04/04");
});

test("予約トークン: {@_NOW|time:...} で時刻フォーマット", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|time:HH:mm}", ctx), "10:20");
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|time:HH時mm分ss秒}", ctx), "10時20分30秒");
});

test("予約トークン: {@_NOW|time:gge年} で和暦変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|time:gge年M月D日}", ctx), "令和8年4月4日");
});

test("予約トークン: {@_NOW} のチェーン変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|time:YYYY|pad:6,0}", ctx), "002026");
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|left:10}", ctx), "2026-04-04");
});

// ---------------------------------------------------------------------------
// nfbResolveGmailTemplateFields_ tests
// ---------------------------------------------------------------------------

test("nfbResolveGmailTemplateFields_ はメールテンプレートフィールドを一括解決する", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { email: "メールアドレス", name: "氏名" },
    fieldValues: { email: "user@example.com", name: "山田太郎" },
    recordId: "rec001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  const action = {
    gmailTemplateTo: "{@メールアドレス}",
    gmailTemplateCc: "admin@example.com",
    gmailTemplateBcc: "",
    gmailTemplateSubject: "【申請】{@_id}_{@氏名}",
    gmailTemplateBody: "お世話になっております。{@氏名}さんの申請です。",
  };
  const result = gas.nfbResolveGmailTemplateFields_(action, ctx);

  assert.equal(result.to, "user@example.com");
  assert.equal(result.cc, "admin@example.com");
  assert.equal(result.bcc, "");
  assert.equal(result.subject, "【申請】rec001_山田太郎");
  assert.equal(result.body, "お世話になっております。山田太郎さんの申請です。");
});

test("nfbResolveGmailTemplateFields_ は空のactionでも安全に動作する", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  const result = gas.nfbResolveGmailTemplateFields_(null, ctx);
  assert.equal(result.to, "");
  assert.equal(result.cc, "");
  assert.equal(result.bcc, "");
  assert.equal(result.subject, "");
  assert.equal(result.body, "");
});

test("nfbResolveGmailTemplateFields_ の本文で Gmail限定トークンが解決される", () => {
  const gas = loadGasContext();
  gas.ScriptApp = {
    getService() {
      return { getUrl() { return "https://script.google.com/macros/s/xxx/exec"; } };
    },
  };
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    recordId: "rec001",
    formId: "form001",
    folderUrl: "https://drive.google.com/drive/folders/folder001",
    recordUrl: "https://script.google.com/macros/s/xxx/exec?form=form001&record=rec001",
    formUrl: "https://script.google.com/macros/s/xxx/exec?form=form001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  const action = {
    gmailTemplateTo: "user@example.com",
    gmailTemplateSubject: "件名",
    gmailTemplateBody: "フォルダ: {@_folder_url} レコード: {@_record_url}",
  };
  const result = gas.nfbResolveGmailTemplateFields_(action, ctx);
  assert.ok(result.body.includes("https://drive.google.com/drive/folders/folder001"));
  assert.ok(result.body.includes("https://script.google.com/macros/s/xxx/exec?form=form001&record=rec001"));
});

// ---------------------------------------------------------------------------
// if パイプ: 新構文 {trueValue|if:condition,elseValue}
// ---------------------------------------------------------------------------

test("if: truthiness で他フィールド参照（参照先に値あり）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者一覧", b: "報告者名" },
    fieldValues: { a: "田中,鈴木", b: "山田" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 報告者一覧が truthy → 報告者一覧の値を返す
  assert.equal(gas.nfbResolveTemplate_("{@報告者一覧|if:@報告者一覧,@報告者名}", ctx), "田中,鈴木");
});

test("if: truthiness で他フィールド参照（参照先が空 → else の @フィールド解決）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者一覧", b: "報告者名" },
    fieldValues: { a: "", b: "山田" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 報告者一覧が空 → else の @報告者名 を解決
  assert.equal(gas.nfbResolveTemplate_("{@報告者一覧|if:@報告者一覧,@報告者名}", ctx), "山田");
});

test("if: truthiness でelse空文字", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者一覧" },
    fieldValues: { a: "田中" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@報告者一覧|if:@報告者一覧,}", ctx), "田中");
  ctx.fieldValues.a = "";
  assert.equal(gas.nfbResolveTemplate_("{@報告者一覧|if:@報告者一覧,}", ctx), "");
});

test("if: not で否定 truthiness", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者一覧" },
    fieldValues: { a: "" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 報告者一覧が空 → not で true → パイプ入力値（空文字）を返す
  assert.equal(gas.nfbResolveTemplate_("{@報告者一覧|if:not @報告者一覧,aaa}", ctx), "");
  // 報告者一覧に値あり → not で false → else値 "aaa"
  ctx.fieldValues.a = "田中";
  assert.equal(gas.nfbResolveTemplate_("{@報告者一覧|if:not @報告者一覧,aaa}", ctx), "aaa");
});

test("if: == 等値比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者一覧" },
    fieldValues: { a: "aaa" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 一致 → パイプ入力値を返す
  assert.equal(gas.nfbResolveTemplate_("{@報告者一覧|if:@報告者一覧==aaa,bbb}", ctx), "aaa");
  // 不一致 → else値
  ctx.fieldValues.a = "xxx";
  assert.equal(gas.nfbResolveTemplate_("{@報告者一覧|if:@報告者一覧==aaa,bbb}", ctx), "bbb");
});

test("if: == クォート付きリテラル比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "性別" },
    fieldValues: { a: "男" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_('{@性別|if:@性別=="男",女}', ctx), "男");
  ctx.fieldValues.a = "女";
  assert.equal(gas.nfbResolveTemplate_('{@性別|if:@性別=="男",女}', ctx), "女");
});

test("if: != 不等比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "状態" },
    fieldValues: { a: "完了" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // "完了" != "未完了" → true → パイプ入力値
  assert.equal(gas.nfbResolveTemplate_("{@状態|if:@状態!=未完了,未完了}", ctx), "完了");
  ctx.fieldValues.a = "未完了";
  assert.equal(gas.nfbResolveTemplate_("{@状態|if:@状態!=未完了,未完了}", ctx), "未完了");
});

test("if: > >= < <= 数値比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "1500" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@金額|if:@金額>1000,低額}", ctx), "1500");
  assert.equal(gas.nfbResolveTemplate_("{@金額|if:@金額<1000,高額}", ctx), "高額");
  assert.equal(gas.nfbResolveTemplate_("{@金額|if:@金額>=1500,未満}", ctx), "1500");
  assert.equal(gas.nfbResolveTemplate_("{@金額|if:@金額<=1000,超過}", ctx), "超過");
});

test("if: フィールド対フィールド比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "金額", b: "基準額" },
    fieldValues: { a: "1500", b: "1000" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@金額|if:@金額>@基準額,基準以下}", ctx), "1500");
  ctx.fieldValues.a = "500";
  assert.equal(gas.nfbResolveTemplate_("{@金額|if:@金額>@基準額,基準以下}", ctx), "基準以下");
});

test("if: in 演算子（文字列包含チェック）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "結果", b: "結果一覧" },
    fieldValues: { a: "合格", b: "合格,不合格,保留" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // "合格" が 結果一覧 に含まれる → true
  assert.equal(gas.nfbResolveTemplate_("{@結果|if:@結果 in @結果一覧,対象外}", ctx), "合格");
  ctx.fieldValues.a = "欠席";
  assert.equal(gas.nfbResolveTemplate_("{@結果|if:@結果 in @結果一覧,対象外}", ctx), "対象外");
});

test("if: in 演算子でリテラル検索", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "メンバー一覧" },
    fieldValues: { a: "田中,鈴木,佐藤" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_('{@メンバー一覧|if:"鈴木" in @メンバー一覧,なし}', ctx), "田中,鈴木,佐藤");
  assert.equal(gas.nfbResolveTemplate_('{@メンバー一覧|if:"山田" in @メンバー一覧,なし}', ctx), "なし");
});

test("if: not と比較演算子の組み合わせ", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "1500" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // not (1500 > 1000) = false → else値
  assert.equal(gas.nfbResolveTemplate_("{@金額|if:not @金額>1000,高額}", ctx), "高額");
});

test("if: else値で _ プレースホルダ（パイプ入力値）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "名前", b: "候補" },
    fieldValues: { a: "山田太郎", b: "鈴木" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 条件不一致 → _ でパイプ入力値を返す
  assert.equal(gas.nfbResolveTemplate_("{@名前|if:@候補,_}", ctx), "山田太郎");
  // 条件一致 → パイプ入力値
  ctx.fieldValues.b = "";
  assert.equal(gas.nfbResolveTemplate_("{@名前|if:@候補,_}", ctx), "山田太郎");
});

test("if: else値で \\_ リテラルアンダースコア", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "名前" },
    fieldValues: { a: "山田太郎" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 条件不一致 → \_ でリテラル "_" を返す
  assert.equal(gas.nfbResolveTemplate_("{@名前|if:@名前==不一致,\\_}", ctx), "_");
});

test("if: 存在しないフィールド参照は空扱い", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者役職" },
    fieldValues: { a: "部長" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // @存在しない は空 → false → else値（パイプ入力値）
  assert.equal(gas.nfbResolveTemplate_("{@報告者役職|if:@存在しない,_}", ctx), "部長");
});

test("if: 他パイプとのチェーン", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "1234567" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // if true → パイプ入力値 → number でフォーマット
  assert.equal(gas.nfbResolveTemplate_("{@金額|if:@金額,0|number:#,##0}", ctx), "1,234,567");
});

// ---------------------------------------------------------------------------
// @ prefix 基本動作テスト
// ---------------------------------------------------------------------------

test("@ prefix: フィールド参照は @ あり/なし両方で動作", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "名前" },
    fieldValues: { f: "山田" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // @ あり → フィールド値（予約トークン優先→フィールド参照）
  assert.equal(gas.nfbResolveTemplate_("{@名前}", ctx), "山田");
  // @ なし → フィールド参照のみ（labelValueMap）
  assert.equal(gas.nfbResolveTemplate_("{名前}", ctx), "山田");
});

test("@ prefix: 予約トークンは @ 必須", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    recordId: "rec001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@_id}", ctx), "rec001");
  assert.equal(gas.nfbResolveTemplate_("{@_NOW|time:YYYY}", ctx), "2026");
  // @ なしでは予約トークンとして解決されない
  assert.equal(gas.nfbResolveTemplate_("{_id}", ctx), "");
});

test("@ prefix: 混合テンプレート", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "氏名" },
    fieldValues: { f: "山田太郎" },
    recordId: "rec001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@_id}_{@氏名}", ctx), "rec001_山田太郎");
});

// ---------------------------------------------------------------------------
// nfbTemplateValueToString_ — ファイルオブジェクト配列の処理
// ---------------------------------------------------------------------------

test("nfbTemplateValueToString_ はファイルオブジェクト配列から name を抽出する", () => {
  const gas = loadGasContext();
  const files = [
    { name: "見積書.pdf", driveFileId: "abc", driveFileUrl: "https://drive.google.com/file/d/abc" },
    { name: "申請書.docx", driveFileId: "def", driveFileUrl: "https://drive.google.com/file/d/def" },
  ];
  assert.equal(gas.nfbTemplateValueToString_(files), "見積書.pdf, 申請書.docx");
});

test("nfbTemplateValueToString_ は単一のファイルオブジェクトから name を抽出する", () => {
  const gas = loadGasContext();
  const file = { name: "見積書.pdf", driveFileId: "abc" };
  assert.equal(gas.nfbTemplateValueToString_(file), "見積書.pdf");
});

test("nfbTemplateValueToString_ は name のないオブジェクトを JSON にする", () => {
  const gas = loadGasContext();
  const obj = { key: "value" };
  assert.equal(gas.nfbTemplateValueToString_(obj), JSON.stringify(obj));
});

// ---------------------------------------------------------------------------
// nfbBuildFieldLabelValueMap_ — fileUploadMeta による拡張子除去
// ---------------------------------------------------------------------------

test("nfbBuildFieldLabelValueMap_ は fileUploadMeta.hideFileExtension で拡張子を除去する", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {
      f1: [{ name: "見積書.pdf" }, { name: "申請書.docx" }],
    },
    fieldLabels: { f1: "添付ファイル" },
    fieldValues: {},
    fileUploadMeta: { f1: { hideFileExtension: true } },
  };
  const map = gas.nfbBuildFieldLabelValueMap_(ctx);
  assert.equal(map["添付ファイル"], "見積書, 申請書");
});

test("nfbBuildFieldLabelValueMap_ は fieldValues がある場合はそちらを優先する", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {
      f1: [{ name: "見積書.pdf" }],
    },
    fieldLabels: { f1: "添付ファイル" },
    fieldValues: { f1: "見積書" },
    fileUploadMeta: { f1: { hideFileExtension: true } },
  };
  const map = gas.nfbBuildFieldLabelValueMap_(ctx);
  assert.equal(map["添付ファイル"], "見積書");
});

// ---------------------------------------------------------------------------
// noext パイプ変換
// ---------------------------------------------------------------------------

test("noext パイプ変換が拡張子を除去する", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f1: "添付" },
    fieldValues: { f1: "見積書.pdf, 申請書.docx" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@添付|noext}", ctx), "見積書, 申請書");
});

test("noext パイプ変換が拡張子のないファイル名をそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f1: "添付" },
    fieldValues: { f1: "README" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplate_("{@添付|noext}", ctx), "README");
});

// ---------------------------------------------------------------------------
// nfbStripFileExtension_
// ---------------------------------------------------------------------------

test("nfbStripFileExtension_ は最後のドット以降を除去する", () => {
  const gas = loadGasContext();
  assert.equal(gas.nfbStripFileExtension_("見積書.pdf"), "見積書");
  assert.equal(gas.nfbStripFileExtension_("file.name.tar.gz"), "file.name.tar");
  assert.equal(gas.nfbStripFileExtension_("README"), "README");
  assert.equal(gas.nfbStripFileExtension_(".hidden"), ".hidden");
  assert.equal(gas.nfbStripFileExtension_(""), "");
  assert.equal(gas.nfbStripFileExtension_(null), "");
});
