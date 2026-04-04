const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGasContext() {
  const context = {
    console,
    DriveApp: {
      getFileById(id) {
        return { getId: () => id };
      },
      getFolderById(id) {
        return { getId: () => id };
      },
    },
  };

  vm.createContext(context);

  const projectRoot = path.join(__dirname, "..");
  const sourceFile = path.join(projectRoot, "gas", "formsParsing.gs");
  const code = fs.readFileSync(sourceFile, "utf8");
  vm.runInContext(code, context, { filename: sourceFile });

  return context;
}

test("Forms_parseGoogleDriveUrl_ は Google ドキュメントURLを file として解釈する", () => {
  const gas = loadGasContext();
  const parsed = gas.Forms_parseGoogleDriveUrl_("https://docs.google.com/document/d/1yo390mM-7qs21puw4F9QeERVaXCgPTzuvcaMMkDzXww/edit?tab=t.0");

  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    type: "file",
    id: "1yo390mM-7qs21puw4F9QeERVaXCgPTzuvcaMMkDzXww",
  });
});

test("Forms_parseGoogleDriveUrl_ は /u/0 を含む Google スプレッドシートURLも file として解釈する", () => {
  const gas = loadGasContext();
  const parsed = gas.Forms_parseGoogleDriveUrl_("https://docs.google.com/spreadsheets/u/0/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0");

  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    type: "file",
    id: "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
  });
});
