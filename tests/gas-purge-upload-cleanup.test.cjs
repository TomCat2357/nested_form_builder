const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// VM realm 由来オブジェクトは prototype が異なり deepStrictEqual で弾かれるため、
// JSON 往復で呼び出し側 realm のプレーンオブジェクトへ正規化してから比較する。
const plain = (value) => JSON.parse(JSON.stringify(value));

// sheetsRecords.gs の Nfb_collectUploadArtifactsFromRow_ / Nfb_trashUploadArtifacts_ /
// Nfb_folderIsUnderUploadBase_ を、Drive 系をモック注入してロードする。
// 06_upload_files 直下に rec_A / rec_B、基底外に outsider を置いた擬似 Drive を用意する。
function setup() {
  const BASE_ID = "base06";
  const trashedFolders = [];
  const trashedFiles = [];

  function folder(id, parentId) {
    return {
      getId: () => id,
      isTrashed: () => trashedFolders.includes(id),
      setTrashed: (v) => { if (v) trashedFolders.push(id); },
      getParents: () => {
        let used = false;
        return { hasNext: () => !used, next: () => { used = true; return { getId: () => parentId }; } };
      },
    };
  }

  const recA = folder("folderA_id", BASE_ID);
  const recB = folder("folderB_id", BASE_ID);
  const outsider = folder("outsider_id", "someOtherParent");
  const foldersById = { folderA_id: recA, folderB_id: recB, outsider_id: outsider };
  const childByName = { rec_A: recA, rec_B: recB };

  const context = {
    console, JSON, Object, Date, isFinite, parseInt,
    Logger: { log: () => {} },
    NFB_MS_PER_DAY: 86400000,
    NFB_DEFAULT_DELETED_RECORD_RETENTION_DAYS: 30,
    StdFolders_autoFileFolderOrNull_: (key) => (key === "upload" ? { getId: () => BASE_ID } : null),
    FormsDrive_childFolderByName_: (parent, name) => {
      const f = childByName[name];
      return f && !f.isTrashed() ? f : null;
    },
    FormsDrive_folderByIdOrNull_: (id) => {
      const f = foldersById[id];
      return f && !f.isTrashed() ? f : null;
    },
    Forms_parseGoogleDriveUrl_: (url) => {
      const m = String(url).match(/\/folders\/([a-zA-Z0-9_-]+)/);
      return m ? { type: "folder", id: m[1] } : { type: null, id: null };
    },
    DriveApp: {
      getFileById: (id) => ({
        isTrashed: () => trashedFiles.includes(id),
        setTrashed: (v) => { if (v) trashedFiles.push(id); },
      }),
    },
  };

  const gas = loadGasFiles(context, ["sheetsRecords.gs"]);
  return { gas, trashedFolders, trashedFiles };
}

const uploadCell = (obj) => JSON.stringify(obj);

test("Nfb_collectUploadArtifactsFromRow_: object 形＋files 配列のセルだけ拾い、非対象は無視する", () => {
  const { gas } = setup();
  const cells = [];
  const row = [
    "rec-001",                                  // 通常テキスト
    12345,                                      // 数値
    "ただのメモ",                               // 非 JSON
    JSON.stringify(["a", "b"]),                 // 素配列（files プロパティ無し）
    uploadCell({
      files: [{ name: "a.pdf", driveFileId: "fileA1" }, { name: "b.pdf", driveFileId: "fileA2" }],
      folderUrl: "https://drive.google.com/drive/folders/folderA_id",
      folderName: "rec_A",
    }),
  ];
  gas.Nfb_collectUploadArtifactsFromRow_(row, cells);
  assert.equal(cells.length, 1);
  assert.deepEqual(plain(cells[0]), {
    folderUrl: "https://drive.google.com/drive/folders/folderA_id",
    folderName: "rec_A",
    fileIds: ["fileA1", "fileA2"],
  });
});

test("Nfb_collectUploadArtifactsFromRow_: folderName 欠落時は folderPath を論理名にフォールバックする", () => {
  const { gas } = setup();
  const cells = [];
  gas.Nfb_collectUploadArtifactsFromRow_([
    uploadCell({ files: [{ name: "c.pdf", driveFileId: "fileC" }], folderPath: "rec_B" }),
  ], cells);
  assert.deepEqual(plain(cells[0]), { folderUrl: "", folderName: "rec_B", fileIds: ["fileC"] });
});

test("Nfb_collectUploadArtifactsFromRow_: null / 空行は安全に無視する", () => {
  const { gas } = setup();
  const cells = [];
  gas.Nfb_collectUploadArtifactsFromRow_(null, cells);
  gas.Nfb_collectUploadArtifactsFromRow_([], cells);
  gas.Nfb_collectUploadArtifactsFromRow_(["", null, undefined], cells);
  assert.equal(cells.length, 0);
});

test("Nfb_trashUploadArtifacts_: folderName で 06_upload_files 直下のフォルダごと trash する", () => {
  const { gas, trashedFolders, trashedFiles } = setup();
  gas.Nfb_trashUploadArtifacts_([
    { folderUrl: "", folderName: "rec_A", fileIds: ["fileA1", "fileA2"] },
  ]);
  assert.deepEqual(trashedFolders, ["folderA_id"]);
  // フォルダごと消えたのでファイルは個別 trash しない（Drive 呼び出し節約）
  assert.deepEqual(trashedFiles, []);
});

test("Nfb_trashUploadArtifacts_: folderName 不在でも folderUrl の親が基底なら trash する", () => {
  const { gas, trashedFolders } = setup();
  gas.Nfb_trashUploadArtifacts_([
    { folderUrl: "https://drive.google.com/drive/folders/folderB_id", folderName: "", fileIds: [] },
  ]);
  assert.deepEqual(trashedFolders, ["folderB_id"]);
});

test("Nfb_trashUploadArtifacts_: 基底外フォルダは trash せず、ファイルだけ個別 trash する", () => {
  const { gas, trashedFolders, trashedFiles } = setup();
  gas.Nfb_trashUploadArtifacts_([
    { folderUrl: "https://drive.google.com/drive/folders/outsider_id", folderName: "", fileIds: ["fileCustom"] },
  ]);
  assert.deepEqual(trashedFolders, []);                 // 基底外は誤爆させない
  assert.deepEqual(trashedFiles, ["fileCustom"]);       // ファイルは消す
});

test("Nfb_trashUploadArtifacts_: 同一フォルダを複数セルが指しても二重 trash しない", () => {
  const { gas, trashedFolders } = setup();
  gas.Nfb_trashUploadArtifacts_([
    { folderUrl: "https://drive.google.com/drive/folders/folderA_id", folderName: "rec_A", fileIds: ["x"] },
    { folderUrl: "https://drive.google.com/drive/folders/folderA_id", folderName: "rec_A", fileIds: ["y"] },
  ]);
  assert.deepEqual(trashedFolders, ["folderA_id"]);
});

test("Nfb_trashUploadArtifacts_: 空配列 / null は no-op", () => {
  const { gas, trashedFolders, trashedFiles } = setup();
  gas.Nfb_trashUploadArtifacts_([]);
  gas.Nfb_trashUploadArtifacts_(null);
  assert.deepEqual(trashedFolders, []);
  assert.deepEqual(trashedFiles, []);
});

test("Nfb_folderIsUnderUploadBase_: 親に基底 ID を含むときだけ true", () => {
  const { gas } = setup();
  const underBase = { getParents: () => { let u = false; return { hasNext: () => !u, next: () => { u = true; return { getId: () => "base06" }; } }; } };
  const elsewhere = { getParents: () => { let u = false; return { hasNext: () => !u, next: () => { u = true; return { getId: () => "other" }; } }; } };
  assert.equal(gas.Nfb_folderIsUnderUploadBase_(underBase, "base06"), true);
  assert.equal(gas.Nfb_folderIsUnderUploadBase_(elsewhere, "base06"), false);
  assert.equal(gas.Nfb_folderIsUnderUploadBase_(null, "base06"), false);
  assert.equal(gas.Nfb_folderIsUnderUploadBase_(underBase, null), false);
});
