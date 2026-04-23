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
    "pipeEngine.js",
    "driveTemplate.gs",
    "drivePrintDocument.gs",
    "driveFolder.gs",
    "driveOutput.gs",
    "driveGmailOutput.gs",
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
  // 新仕様: @ が付かない {YYYY-MM-DD} {UNKNOWN} は式言語のリテラル文字列として
  // そのまま出力される（旧仕様では空文字に置換されていた）
  assert.equal(bodyText.getText(), "本文 山田 太郎 rec001 YYYY-MM-DD UNKNOWN");
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

test("nfbApplyTemplateReplacementsToGoogleDocument_ は if 3引数 のサブテンプレート（ネストした{}）を正しく解決する", () => {
  const gas = loadGasContext();

  const withValue = createTextElement("報告{@報道（予定）等|if:_,（{@報道（予定）等}）,}");
  const withoutValue = createTextElement("報告{@報道（予定）等|if:_,（{@報道（予定）等}）,}");
  const usingUnderscore = createTextElement("状態{@報道（予定）等|if:_,（{_}）,}");

  function makeDoc(text) {
    return {
      getBody() { return createContainer([text]); },
      getHeader() { return null; },
      getFooter() { return null; },
    };
  }

  const contextWithValue = {
    responses: { f1: "記事掲載" },
    fieldLabels: { f1: "報道（予定）等" },
    fieldValues: { f1: "記事掲載" },
    fileUploadMeta: {},
    recordId: "rec001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  const contextWithoutValue = {
    responses: { f1: "" },
    fieldLabels: { f1: "報道（予定）等" },
    fieldValues: { f1: "" },
    fileUploadMeta: {},
    recordId: "rec001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };

  gas.nfbApplyTemplateReplacementsToGoogleDocument_(makeDoc(withValue), contextWithValue);
  gas.nfbApplyTemplateReplacementsToGoogleDocument_(makeDoc(withoutValue), contextWithoutValue);
  gas.nfbApplyTemplateReplacementsToGoogleDocument_(makeDoc(usingUnderscore), contextWithValue);

  assert.equal(withValue.getText(), "報告（記事掲載）");
  assert.equal(withoutValue.getText(), "報告");
  assert.equal(usingUnderscore.getText(), "状態（記事掲載）");
});

test("nfbResolveRecordOutputFileNameTemplate_ は標準ファイル名未設定時に既定値へフォールバックする", () => {
  const gas = loadGasContext();

  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: {} },
      { outputType: "pdf", fileNameTemplate: "" },
      "pdf",
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
  gas.nfbResolveTemplateTokens_ = () => "rec001_output";
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
  gas.nfbResolveTemplateTokens_ = (template, context) => `${template}:${context.recordId}`;

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
  gas.nfbResolveTemplateTokens_ = () => "改名されない";

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
  assert.equal(gas.nfbResolveTemplateTokens_("{@備考|left:3}", ctx), "あいう");
  assert.equal(gas.nfbResolveTemplateTokens_("{@備考|right:2}", ctx), "えお");
  assert.equal(gas.nfbResolveTemplateTokens_("{@備考|mid:1,3}", ctx), "いうえ");
});

test("パイプ変換: date フォーマットで日付フィールドを整形", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { dob: "生年月日" },
    fieldValues: { dob: "2000-01-15" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@生年月日|time:YYYY}", ctx), "2000");
  assert.equal(gas.nfbResolveTemplateTokens_("{@生年月日|time:YYYY/MM/DD}", ctx), "2000/01/15");
  assert.equal(gas.nfbResolveTemplateTokens_("{@生年月日|time:YYYY年M月D日}", ctx), "2000年1月15日");
  assert.equal(gas.nfbResolveTemplateTokens_("{@生年月日|time:YY}", ctx), "00");
});

test("パイプ変換: date で和暦（元号）に変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { dob: "生年月日" },
    fieldValues: { dob: "2000-01-15" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@生年月日|time:gg}", ctx), "平成");
  assert.equal(gas.nfbResolveTemplateTokens_("{@生年月日|time:gge年}", ctx), "平成12年");
  assert.equal(gas.nfbResolveTemplateTokens_("{@生年月日|time:gge年M月D日}", ctx), "平成12年1月15日");
});

test("パイプ変換: 令和の日付を和暦に変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { d: "入社日" },
    fieldValues: { d: "2026-04-01" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@入社日|time:gge年}", ctx), "令和8年");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@生年月日|time:YYYY|pad:6,0}", ctx), "002000");
});

test("パイプ変換: upper/lower/trim", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { code: "コード" },
    fieldValues: { code: "  aBcD  " },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@コード|trim}", ctx), "aBcD");
  assert.equal(gas.nfbResolveTemplateTokens_("{@コード|trim|upper}", ctx), "ABCD");
  assert.equal(gas.nfbResolveTemplateTokens_("{@コード|trim|lower}", ctx), "abcd");
});

test("パイプ変換: default で空値にフォールバック", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { tel: "電話" },
    fieldValues: { tel: "" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@電話|default:未入力}", ctx), "未入力");
});

test("パイプ変換: default で @参照 を解決（空時は参照フィールド値で埋める）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { handler: "対応者", reporter: "報告者" },
    fieldValues: { handler: "", reporter: "春元 負比呂" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@対応者|default:@報告者}", ctx), "春元 負比呂");
});

test("パイプ変換: default — 値がある場合は参照を読まない", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { handler: "対応者", reporter: "報告者" },
    fieldValues: { handler: "田中", reporter: "春元 負比呂" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@対応者|default:@報告者}", ctx), "田中");
});

test("パイプ変換: default — 参照先も空ならリテラル @表記を返さず空を返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { handler: "対応者", reporter: "報告者" },
    fieldValues: { handler: "", reporter: "" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@対応者|default:@報告者}", ctx), "");
});

test("パイプ変換: replace で文字列を全置換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { addr: "住所" },
    fieldValues: { addr: "東京都-新宿区-西新宿" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@住所|replace:-,/}", ctx), "東京都/新宿区/西新宿");
});

test("パイプ変換: 予約トークン + パイプ", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|time:YYYY|left:2}", ctx), "20");
});

test("パイプ変換: パース不能な日付はそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "自由入力" },
    fieldValues: { f: "abc" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@自由入力|time:YYYY}", ctx), "abc");
});

test("パイプ変換: 不明な変換名はスルーされる", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "名前" },
    fieldValues: { f: "山田" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|unknown:5}", ctx), "山田");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@入社日|time:YYYY/MM/DD(ddd)}", ctx), "2026/04/04(土)");
  assert.equal(gas.nfbResolveTemplateTokens_("{@入社日|time:dddd}", ctx), "土曜日");
  // Monday
  ctx.fieldValues.d = "2026-04-06";
  assert.equal(gas.nfbResolveTemplateTokens_("{@入社日|time:ddd}", ctx), "月");
  assert.equal(gas.nfbResolveTemplateTokens_("{@入社日|time:dddd}", ctx), "月曜日");
});

test("パイプ変換: time で時刻を整形", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { t: "受付時間" },
    fieldValues: { t: "14:30" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@受付時間|time:HH時mm分}", ctx), "14時30分");
  assert.equal(gas.nfbResolveTemplateTokens_("{@受付時間|time:H:m}", ctx), "14:30");
});

test("パイプ変換: time で秒付き時刻を整形", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { t: "時刻" },
    fieldValues: { t: "9:05:07" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@時刻|time:HH:mm:ss}", ctx), "09:05:07");
  assert.equal(gas.nfbResolveTemplateTokens_("{@時刻|time:H時m分s秒}", ctx), "9時5分7秒");
});

test("パイプ変換: time でdatetime文字列から時刻を抽出", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { dt: "日時" },
    fieldValues: { dt: "2026-04-04 14:30:00" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@日時|time:HH:mm}", ctx), "14:30");
});

test("パイプ変換: time でパース不能な値はそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { t: "自由入力" },
    fieldValues: { t: "abc" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@自由入力|time:HH:mm}", ctx), "abc");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@メール|match:[^@]+}", ctx), "user");
  // With group
  assert.equal(gas.nfbResolveTemplateTokens_("{@メール|match:(.+)@(.+),1}", ctx), "user");
  assert.equal(gas.nfbResolveTemplateTokens_("{@メール|match:(.+)@(.+),2}", ctx), "example.com");
});

test("パイプ変換: match でマッチしない場合は空文字", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "abcdef" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@テキスト|match:\\d+}", ctx), "");
});

test("パイプ変換: match で不正な正規表現は元の値を返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "abc" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@テキスト|match:[invalid}", ctx), "abc");
});

test("パイプ変換: number で数値フォーマット", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "1234567" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|number:#,##0}", ctx), "1,234,567");
  ctx.fieldValues.n = "3.14159";
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|number:0.00}", ctx), "3.14");
  ctx.fieldValues.n = "1234567.89";
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|number:#,##0.00}", ctx), "1,234,567.89");
});

test("パイプ変換: number で接尾辞付きフォーマット", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "1234567" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|number:#,##0円}", ctx), "1,234,567円");
});

test("パイプ変換: number で非数値はそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "abc" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|number:#,##0}", ctx), "abc");
});

test("パイプ変換: if で == 等値比較 (3引数)", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { g: "性別" },
    fieldValues: { g: "男" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 条件一致 → _ （パイプ入力値 = 性別の値）を返す
  assert.equal(gas.nfbResolveTemplateTokens_("{@性別|if:@性別==男,_,Ms.}", ctx), "男");
  // 条件不一致 → falseValue
  ctx.fieldValues.g = "女";
  assert.equal(gas.nfbResolveTemplateTokens_("{@性別|if:@性別==男,_,Ms.}", ctx), "Ms.");
});

test("パイプ変換: if で truthiness 判定 (3引数)", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "備考" },
    fieldValues: { f: "あり" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 値あり → パイプ入力値を返す
  assert.equal(gas.nfbResolveTemplateTokens_("{@備考|if:@備考,_,なし}", ctx), "あり");
  // 値なし → falseValue
  ctx.fieldValues.f = "";
  assert.equal(gas.nfbResolveTemplateTokens_("{@備考|if:@備考,_,なし}", ctx), "なし");
});

test("パイプ変換: map で値をマッピング", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { e: "評価" },
    fieldValues: { e: "A" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@評価|map:A=優;B=良;C=可;*=不明}", ctx), "優");
  ctx.fieldValues.e = "C";
  assert.equal(gas.nfbResolveTemplateTokens_("{@評価|map:A=優;B=良;C=可;*=不明}", ctx), "可");
  ctx.fieldValues.e = "Z";
  assert.equal(gas.nfbResolveTemplateTokens_("{@評価|map:A=優;B=良;C=可;*=不明}", ctx), "不明");
});

test("パイプ変換: map でデフォルトなし・マッチなしは元の値", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { e: "評価" },
    fieldValues: { e: "Z" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@評価|map:A=優;B=良}", ctx), "Z");
});

test("パイプ変換: kana でひらがなをカタカナに変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "名前" },
    fieldValues: { f: "やまだ たろう" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|kana}", ctx), "ヤマダ タロウ");
});

test("パイプ変換: zen で半角を全角に変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "ABC 123" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@テキスト|zen}", ctx), "\uFF21\uFF22\uFF23\u3000\uFF11\uFF12\uFF13");
});

test("パイプ変換: zen で半角カナを全角カナに変換（濁音含む）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "カナ" },
    fieldValues: { f: "\uFF76\uFF9E\uFF77\uFF9E" }, // ｶﾞｷﾞ
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@カナ|zen}", ctx), "ガギ");
});

test("パイプ変換: han で全角を半角に変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "テキスト" },
    fieldValues: { f: "\uFF21\uFF22\uFF23\u3000\uFF11\uFF12\uFF13" }, // ＡＢＣ　１２３
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@テキスト|han}", ctx), "ABC 123");
});

test("パイプ変換: han で全角カナを半角カナに変換（濁音含む）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "カナ" },
    fieldValues: { f: "ガギ" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@カナ|han}", ctx), "\uFF76\uFF9E\uFF77\uFF9E"); // ｶﾞｷﾞ
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@テキスト|replace:-,\\|}", ctx), "A|B|C");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|kana|han}", ctx), "\uFF94\uFF8F\uFF80\uFF9E"); // ﾔﾏﾀﾞ
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW}", ctx), "2026-04-04 10:20:30");
});

test("予約トークン: {@_NOW|time:...} で日付フォーマット", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|time:YYYY年M月D日}", ctx), "2026年4月4日");
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|time:YYYY/MM/DD}", ctx), "2026/04/04");
});

test("予約トークン: {@_NOW|time:...} で時刻フォーマット", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|time:HH:mm}", ctx), "10:20");
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|time:HH時mm分ss秒}", ctx), "10時20分30秒");
});

test("予約トークン: {@_NOW|time:gge年} で和暦変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|time:gge年M月D日}", ctx), "令和8年4月4日");
});

test("予約トークン: {@_NOW} のチェーン変換", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|time:YYYY|pad:6,0}", ctx), "002026");
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|left:10}", ctx), "2026-04-04");
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
    gmailTemplateBody: "フォーム: {@_form_url} レコード: {@_record_url}",
  };
  const result = gas.nfbResolveGmailTemplateFields_(action, ctx);
  assert.ok(result.body.includes("https://script.google.com/macros/s/xxx/exec?form=form001"));
  assert.ok(result.body.includes("https://script.google.com/macros/s/xxx/exec?form=form001&record=rec001"));
});

// ---------------------------------------------------------------------------
// if パイプ: 新構文 {trueValue|if:condition,_,elseValue}
// ---------------------------------------------------------------------------

test("if: truthiness で他フィールド参照（参照先に値あり）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者一覧", b: "報告者名" },
    fieldValues: { a: "田中,鈴木", b: "山田" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 報告者一覧が truthy → _ (パイプ入力値 = 報告者一覧の値)を返す
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者一覧|if:@報告者一覧,_,@報告者名}", ctx), "田中,鈴木");
});

test("if: truthiness で他フィールド参照（参照先が空 → falseValue の @フィールド解決）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者一覧", b: "報告者名" },
    fieldValues: { a: "", b: "山田" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 報告者一覧が空 → falseValue の @報告者名 を解決
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者一覧|if:@報告者一覧,_,@報告者名}", ctx), "山田");
});

test("if: truthiness でelse空文字", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "報告者一覧" },
    fieldValues: { a: "田中" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者一覧|if:@報告者一覧,}", ctx), "田中");
  ctx.fieldValues.a = "";
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者一覧|if:@報告者一覧,}", ctx), "");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者一覧|if:not @報告者一覧,_,aaa}", ctx), "");
  // 報告者一覧に値あり → not で false → else値 "aaa"
  ctx.fieldValues.a = "田中";
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者一覧|if:not @報告者一覧,_,aaa}", ctx), "aaa");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者一覧|if:@報告者一覧==aaa,_,bbb}", ctx), "aaa");
  // 不一致 → else値
  ctx.fieldValues.a = "xxx";
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者一覧|if:@報告者一覧==aaa,_,bbb}", ctx), "bbb");
});

test("if: == クォート付きリテラル比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "性別" },
    fieldValues: { a: "男" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_('{@性別|if:@性別=="男",_,女}', ctx), "男");
  ctx.fieldValues.a = "女";
  assert.equal(gas.nfbResolveTemplateTokens_('{@性別|if:@性別=="男",_,女}', ctx), "女");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@状態|if:@状態!=未完了,_,未完了}", ctx), "完了");
  ctx.fieldValues.a = "未完了";
  assert.equal(gas.nfbResolveTemplateTokens_("{@状態|if:@状態!=未完了,_,未完了}", ctx), "未完了");
});

test("if: > >= < <= 数値比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { n: "金額" },
    fieldValues: { n: "1500" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:@金額>1000,_,低額}", ctx), "1500");
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:@金額<1000,_,高額}", ctx), "高額");
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:@金額>=1500,_,未満}", ctx), "1500");
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:@金額<=1000,_,超過}", ctx), "超過");
});

test("if: フィールド対フィールド比較", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "金額", b: "基準額" },
    fieldValues: { a: "1500", b: "1000" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:@金額>@基準額,_,基準以下}", ctx), "1500");
  ctx.fieldValues.a = "500";
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:@金額>@基準額,_,基準以下}", ctx), "基準以下");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@結果|if:@結果 in @結果一覧,_,対象外}", ctx), "合格");
  ctx.fieldValues.a = "欠席";
  assert.equal(gas.nfbResolveTemplateTokens_("{@結果|if:@結果 in @結果一覧,_,対象外}", ctx), "対象外");
});

test("if: in 演算子でリテラル検索", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { a: "メンバー一覧" },
    fieldValues: { a: "田中,鈴木,佐藤" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_('{@メンバー一覧|if:"鈴木" in @メンバー一覧,_,なし}', ctx), "田中,鈴木,佐藤");
  assert.equal(gas.nfbResolveTemplateTokens_('{@メンバー一覧|if:"山田" in @メンバー一覧,_,なし}', ctx), "なし");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:not @金額>1000,_,高額}", ctx), "高額");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|if:@候補,_,_}", ctx), "山田太郎");
  // 条件一致 → パイプ入力値
  ctx.fieldValues.b = "";
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|if:@候補,_,_}", ctx), "山田太郎");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|if:@名前==不一致,_,\\_}", ctx), "_");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@報告者役職|if:@存在しない,_,_}", ctx), "部長");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:@金額,0|number:#,##0}", ctx), "1,234,567");
});

// ---------------------------------------------------------------------------
// @ prefix 基本動作テスト
// ---------------------------------------------------------------------------

test("@ prefix: フィールド参照は @ 必須（新仕様: @ なしはリテラル）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f: "名前" },
    fieldValues: { f: "山田" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // @ あり → フィールド値（予約トークン優先→フィールド参照）
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前}", ctx), "山田");
  // 新仕様: @ なしは式言語の bare word リテラルとして扱われ、そのまま文字列になる
  assert.equal(gas.nfbResolveTemplateTokens_("{名前}", ctx), "名前");
});

test("@ prefix: 予約トークンは @ 必須（新仕様: @ なしはリテラル）", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: {},
    fieldValues: {},
    recordId: "rec001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@_id}", ctx), "rec001");
  assert.equal(gas.nfbResolveTemplateTokens_("{@_NOW|time:YYYY}", ctx), "2026");
  // 新仕様: @ なしは bare word リテラルとしてそのまま出力される
  assert.equal(gas.nfbResolveTemplateTokens_("{_id}", ctx), "_id");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@_id}_{@氏名}", ctx), "rec001_山田太郎");
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
  assert.equal(gas.nfbResolveTemplateTokens_("{@添付|noext}", ctx), "見積書, 申請書");
});

test("noext パイプ変換が拡張子のないファイル名をそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    responses: {},
    fieldLabels: { f1: "添付" },
    fieldValues: { f1: "README" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@添付|noext}", ctx), "README");
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

// ---------------------------------------------------------------------------
// if パイプ: 3引数 if — {field|if:condition,trueValue,falseValue}
// ---------------------------------------------------------------------------

test("if: 3引数基本 — 条件一致で真の値、不一致で偽の値", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "対応方法" },
    fieldValues: { a: "来庁" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@対応方法|if:@対応方法==来庁,■,□}", ctx), "■");
  ctx.fieldValues.a = "電話";
  assert.equal(gas.nfbResolveTemplateTokens_("{@対応方法|if:@対応方法==来庁,■,□}", ctx), "□");
});

test("if: 3引数 in 演算子でチェックボックス部分一致", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "報道の結果" },
    fieldValues: { a: "記事掲載, その他" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@報道の結果|if:記事掲載 in _,■,□}", ctx), "■");
  assert.equal(gas.nfbResolveTemplateTokens_("{@報道の結果|if:放送予定 in _,■,□}", ctx), "□");
  assert.equal(gas.nfbResolveTemplateTokens_("{@報道の結果|if:その他 in _,■,□}", ctx), "■");
  assert.equal(gas.nfbResolveTemplateTokens_("{@報道の結果|if:報道なし in _,■,□}", ctx), "□");
});

test("if: 3引数 真の値に _ でパイプ入力値を返す", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "名前" },
    fieldValues: { a: "山田太郎" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|if:@名前,_,不明}", ctx), "山田太郎");
  ctx.fieldValues.a = "";
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|if:@名前,_,不明}", ctx), "不明");
});

test("if: 3引数 真の値・偽の値に @ref でフィールド参照解決", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "状態", b: "完了メッセージ", c: "未完了メッセージ" },
    fieldValues: { a: "完了", b: "OK", c: "NG" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@状態|if:@状態==完了,@完了メッセージ,@未完了メッセージ}", ctx), "OK");
  ctx.fieldValues.a = "未完了";
  assert.equal(gas.nfbResolveTemplateTokens_("{@状態|if:@状態==完了,@完了メッセージ,@未完了メッセージ}", ctx), "NG");
});

test("if: 3引数 not 否定との組み合わせ", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "備考" },
    fieldValues: { a: "あり" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@備考|if:not @備考,空です,値あり}", ctx), "値あり");
  ctx.fieldValues.a = "";
  assert.equal(gas.nfbResolveTemplateTokens_("{@備考|if:not @備考,空です,値あり}", ctx), "空です");
});

test("if: 3引数 他パイプとのチェーン", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "金額" },
    fieldValues: { a: "1500" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@金額|if:@金額>1000,_,0|number:#,##0}", ctx), "1,500");
});

test("if: 3引数 カンマ不足（引数1つ以下）はパイプ入力値をそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "名前" },
    fieldValues: { a: "太郎" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|if:@名前}", ctx), "太郎");
  assert.equal(gas.nfbResolveTemplateTokens_("{@名前|if:@名前,_,OK}", ctx), "太郎");
});

// ---------------------------------------------------------------------------
// サブテンプレート: パイプ引数値内で {...} トークンを再帰解決
// ---------------------------------------------------------------------------

test("subtemplate: if 3引数 真の値でフィールド参照とリテラル文字列を組み合わせ", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "状態", b: "対応者" },
    fieldValues: { a: "完了", b: "山田" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@状態|if:@状態==完了,({@対応者})記載あり,記載なし}", ctx),
    "(山田)記載あり"
  );
  ctx.fieldValues.a = "未対応";
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@状態|if:@状態==完了,({@対応者})記載あり,記載なし}", ctx),
    "記載なし"
  );
});

test("subtemplate: default 引数でフィールド参照とリテラル文字列を組み合わせ", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "納期", b: "登録日" },
    fieldValues: { a: "", b: "2026-04-04" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@納期|default:未定（{@登録日|time:M月D日}時点）}", ctx),
    "未定（4月4日時点）"
  );
  ctx.fieldValues.a = "2026-05-01";
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@納期|default:未定（{@登録日|time:M月D日}時点）}", ctx),
    "2026-05-01"
  );
});

test("subtemplate: if else値でサブテンプレート", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "備考", b: "氏名" },
    fieldValues: { a: "", b: "佐藤" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@備考|if:@備考,_,（{@氏名}より）}", ctx),
    "（佐藤より）"
  );
});

test("subtemplate: {_} と {@_} はサブテンプレート内でパイプ入力値を返す", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "報告" },
    fieldValues: { a: "受領" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@報告|if:@報告,({_})完了,未完了}", ctx),
    "(受領)完了"
  );
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@報告|if:@報告,({@_})完了,未完了}", ctx),
    "(受領)完了"
  );
});

test("subtemplate: トップレベルの {_} はリテラル _ （パイプ値なし・新仕様）", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: {},
    fieldValues: {},
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 新仕様: {@foo} でない bare word はリテラル文字列として出力される。
  // 従って {_} はパイプ値コンテキストが無い限りリテラル "_" になる。
  assert.equal(gas.nfbResolveTemplateTokens_("{_}", ctx), "_");
});

test("subtemplate: if 3引数 のサブテンプレートでパイプ変換チェーン", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "ステータス", b: "金額" },
    fieldValues: { a: "確定", b: "1500" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@ステータス|if:@ステータス==確定,¥{@金額|number:#,##0},未確定}", ctx),
    "¥1,500"
  );
});

test("subtemplate: 2段ネストの if", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "種別", b: "詳細A", c: "詳細B" },
    fieldValues: { a: "A", b: "Aの内容", c: "Bの内容" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_(
      "{@種別|if:@種別==A,A:{@詳細A},{@種別|if:@種別==B,B:{@詳細B},不明}}",
      ctx
    ),
    "A:Aの内容"
  );
  ctx.fieldValues.a = "B";
  assert.equal(
    gas.nfbResolveTemplateTokens_(
      "{@種別|if:@種別==A,A:{@詳細A},{@種別|if:@種別==B,B:{@詳細B},不明}}",
      ctx
    ),
    "B:Bの内容"
  );
  ctx.fieldValues.a = "C";
  assert.equal(
    gas.nfbResolveTemplateTokens_(
      "{@種別|if:@種別==A,A:{@詳細A},{@種別|if:@種別==B,B:{@詳細B},不明}}",
      ctx
    ),
    "不明"
  );
});

test("subtemplate: サブテンプレート内のコンマで誤分割されない", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "値", b: "ラベル" },
    fieldValues: { a: "1", b: "未設定" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // {@値|map:1=A;2=B;*=C} の中のセミコロンや、if 引数の中の {} はコンマで誤分割されない
  assert.equal(
    gas.nfbResolveTemplateTokens_(
      "{@値|if:@値,選択:{@値|map:1=甲;2=乙;*=その他},{@ラベル}}",
      ctx
    ),
    "選択:甲"
  );
  ctx.fieldValues.a = "";
  assert.equal(
    gas.nfbResolveTemplateTokens_(
      "{@値|if:@値,選択:{@値|map:1=甲;2=乙;*=その他},{@ラベル}}",
      ctx
    ),
    "未設定"
  );
});

test("subtemplate: \\{ \\} エスケープがサブテンプレート内でも機能する", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "名前" },
    fieldValues: { a: "太郎" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@名前|if:@名前,\\{{@名前}\\},未入力}", ctx),
    "{太郎}"
  );
});

test("subtemplate: 未閉鎖ブレースは安全に文字列扱い", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "名前" },
    fieldValues: { a: "太郎" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("prefix {未閉鎖", ctx), "prefix {未閉鎖");
});

test("subtemplate: replace の to が {} を含む値でもコンマ位置を正しく解釈", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "テキスト" },
    fieldValues: { a: "X-Y-Z" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // ブレース対応コンマ分割: from="-", to="{x}"（リテラル）
  assert.equal(
    gas.nfbResolveTemplateTokens_("{@テキスト|replace:-,{x}}", ctx),
    "X{x}Y{x}Z"
  );
});

test("subtemplate: パイプ \\| エスケープが引き続き機能", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "テキスト" },
    fieldValues: { a: "A-B-C" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@テキスト|replace:-,\\|}", ctx), "A|B|C");
});

// ---------------------------------------------------------------------------
// 新構文: 式言語 (+ 演算子 / parseINT / parseFLOAT / quoted @ / if 関数形式 / ネスト)
// ---------------------------------------------------------------------------

test("式言語: bare word はリテラル文字列 {aaa} → \"aaa\"", () => {
  const gas = loadGasContext();
  const ctx = { fieldLabels: {}, fieldValues: {}, responses: {}, now: new Date() };
  assert.equal(gas.nfbResolveTemplateTokens_("{aaa}", ctx), "aaa");
});

test("式言語: 文字列リテラル / 数値リテラル", () => {
  const gas = loadGasContext();
  const ctx = { fieldLabels: {}, fieldValues: {}, responses: {}, now: new Date() };
  assert.equal(gas.nfbResolveTemplateTokens_('{"hello world"}', ctx), "hello world");
  assert.equal(gas.nfbResolveTemplateTokens_("{42}", ctx), "42");
  assert.equal(gas.nfbResolveTemplateTokens_("{3.14}", ctx), "3.14");
});

test("式言語: + 演算子 — 両辺文字列は連結", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "所属", b: "氏名" },
    fieldValues: { a: "営業", b: "山田" },
    responses: {}, now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{@所属+@氏名}", ctx), "営業山田");
});

test("式言語: parseINT で数値型を通し + が算術加算になる", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "年齢" },
    fieldValues: { a: "30" },
    responses: {}, now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{@年齢|parseINT}+1}", ctx), "31");
});

test("式言語: parseFLOAT で浮動小数点の算術加算", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "単価" },
    fieldValues: { a: "1.25" },
    responses: {}, now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{@単価|parseFLOAT}+0.5}", ctx), "1.75");
});

test("式言語: 数値 + 文字列は JS 準拠で文字列連結", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "年齢" },
    fieldValues: { a: "30" },
    responses: {}, now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_('{{@年齢|parseINT}+" years"}', ctx), "30 years");
});

test("式言語: ネスト {{}} で評価順を強制", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "a", b: "b" },
    fieldValues: { a: "Hi", b: "WORLD" },
    responses: {}, now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{@a|upper}+{@b|lower}}", ctx), "HIworld");
});

test("式言語: if 関数形式 {if:cond,true,false}", () => {
  const gas = loadGasContext();
  const ctx1 = {
    fieldLabels: { a: "x" },
    fieldValues: { a: "1" },
    responses: {}, now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_('{if:@x=="1",one,other}', ctx1), "one");
  ctx1.fieldValues.a = "2";
  assert.equal(gas.nfbResolveTemplateTokens_('{if:@x=="1",one,other}', ctx1), "other");
});

test("式言語: フィールド名のダブルクォート / バックスラッシュ escape", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "a+b", b: "日 本" },
    fieldValues: { a: "plus", b: "nihon" },
    responses: {}, now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_('{@"a+b"}', ctx), "plus");
  assert.equal(gas.nfbResolveTemplateTokens_('{@"日 本"}', ctx), "nihon");
  assert.equal(gas.nfbResolveTemplateTokens_("{@a\\+b}", ctx), "plus");
});

test("式言語: パース不能時は原トークンを残す", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "氏名" },
    fieldValues: { a: "山田" },
    responses: {}, now: new Date(),
  };
  // @氏名in 田中 は in と 田中 が operator なしに並ぶのでエラー
  assert.equal(gas.nfbResolveTemplateTokens_("{@氏名in 田中}", ctx), "{@氏名in 田中}");
  // @ に続けて何もない
  assert.equal(gas.nfbResolveTemplateTokens_("{@}", ctx), "{@}");
  // if 関数の引数不足
  assert.equal(gas.nfbResolveTemplateTokens_("{if:a}", ctx), "{if:a}");
  // 未閉鎖文字列
  assert.equal(gas.nfbResolveTemplateTokens_('{"unterminated}', ctx), '{"unterminated}');
});

test("式言語: parseINT の結果に number パイプをチェーン可能", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldLabels: { a: "金額1", b: "金額2" },
    fieldValues: { a: "1000", b: "2000" },
    responses: {}, now: new Date(),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{{{@金額1|parseINT}+{@金額2|parseINT}}|number:#,##0}", ctx),
    "3,000"
  );
});

test("式言語: extractFieldRefs で @ 参照を抽出（複数・重複排除・予約除外）", () => {
  const gas = loadGasContext();
  const refs = gas.nfbExtractFieldRefs_("{@所属+@氏名} / {@_id} / {@氏名|upper}");
  // VM realm boundary: arrays aren't reference-equal, so compare contents.
  assert.equal(refs.length, 2);
  assert.equal(refs[0], "所属");
  assert.equal(refs[1], "氏名");
});
