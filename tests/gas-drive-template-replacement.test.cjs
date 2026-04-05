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
  const sourceFile = path.join(projectRoot, "gas", "drive.gs");
  const code = fs.readFileSync(sourceFile, "utf8");
  vm.runInContext(code, context, { filename: sourceFile });
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
  const bodyText = createTextElement("本文 {氏名} {ID} {YYYY-MM-DD} {UNKNOWN}");
  const tableCellText = createTextElement("セル {部署}");
  const headerText = createTextElement("header {氏名}");
  const footerText = createTextElement("footer {ID}");
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
    fileNameTemplate: "{ID}_{氏名}",
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
  assert.equal(bodyText.getText(), "本文 山田 太郎 rec001 2026-04-04 {UNKNOWN}");
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
    "{ID}_{YYYY-MM-DD}_{氏名}",
  );

  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: { standardPrintFileNameTemplate: "   " } },
      { outputType: "pdf", fileNameTemplate: "" },
      "pdf",
    ),
    "{ID}_{YYYY-MM-DD}_{氏名}",
  );

  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: {} },
      { outputType: "gmail", fileNameTemplate: "", gmailTemplateBody: "本文 {_PDF}" },
      "gmail",
    ),
    "{ID}_{YYYY-MM-DD}_{氏名}",
  );
});
