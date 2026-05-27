const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// standardFolders.gs の純粋ヘルパー（リンク再配線・スキーマ走査）を検証する。
// DriveApp / PropertiesService を使わない関数のみが対象。
function loadGasContext() {
  const context = {
    console,
    NFB_DEFAULT_SHEET_NAME: "Data",
    DriveApp: {
      getFileById(id) { return { getId: () => id }; },
      getFolderById(id) { return { getId: () => id }; },
    },
    // consume テスト用の軽量スタブ（standardFolders.gs では未定義の依存）。
    nfbSafeCall_(fn) { return fn(); },
    nfbErrorToString_(err) { return String((err && err.message) || err); },
  };
  // standardFolders.gs は formsParsing.gs（Forms_parseGoogleDriveUrl_）と model.gs（Model_normalizeSpreadsheetId_）に依存。
  return loadGasFiles(context, ["formsParsing.gs", "model.gs", "standardFolders.gs"]);
}

// getFilesByName / createFile / setTrashed を備えた最小フォルダモック。
function makeMockFolder(rootId) {
  const files = [];
  const folder = {
    _files: files,
    getId: () => rootId || "ROOT",
    getFilesByName(name) {
      const matches = files.filter((f) => f._name === name);
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => matches[i++] };
    },
    createFile(name, content) {
      const f = {
        _name: name,
        _content: content,
        _trashed: false,
        getId: () => "FILE_" + name,
        getUrl: () => "https://drive.google.com/file/d/FILE_" + name + "/view",
        isTrashed: () => f._trashed,
        setTrashed: (v) => { f._trashed = !!v; },
        getBlob: () => ({ getDataAsString: () => f._content }),
      };
      files.push(f);
      return f;
    },
  };
  return folder;
}

test("StdFolders_remapFileUrl_: idMap にあるファイル URL を新 URL へ置換する", () => {
  const gas = loadGasContext();
  const idMap = { OLDID12345678901: { newFileId: "NEW", newUrl: "https://drive.google.com/file/d/NEW/view" } };
  const res = gas.StdFolders_remapFileUrl_("https://drive.google.com/file/d/OLDID12345678901/view", idMap);
  assert.equal(res.status, "remapped");
  assert.equal(res.value, "https://drive.google.com/file/d/NEW/view");
});

test("StdFolders_remapFileUrl_: idMap に無いファイル（標準構成外）はクリアする", () => {
  const gas = loadGasContext();
  const res = gas.StdFolders_remapFileUrl_("https://drive.google.com/file/d/UNKNOWNFILEID999/view", {});
  assert.equal(res.status, "cleared");
  assert.equal(res.value, "");
});

test("StdFolders_remapFileUrl_: 空文字は unchanged", () => {
  const gas = loadGasContext();
  const res = gas.StdFolders_remapFileUrl_("", {});
  assert.equal(res.status, "unchanged");
  assert.equal(res.value, "");
});

test("StdFolders_remapFileUrl_: スプレッドシート URL も idMap で置換する", () => {
  const gas = loadGasContext();
  const idMap = { SHEETID1234567890: { newFileId: "NEWSS", newUrl: "https://docs.google.com/spreadsheets/d/NEWSS/edit" } };
  const res = gas.StdFolders_remapFileUrl_("https://docs.google.com/spreadsheets/d/SHEETID1234567890/edit", idMap);
  assert.equal(res.status, "remapped");
  assert.equal(res.value, "https://docs.google.com/spreadsheets/d/NEWSS/edit");
});

test("StdFolders_remapFolderUrl_: folderIdMap にあるフォルダを置換、無ければクリア", () => {
  const gas = loadGasContext();
  const folderIdMap = { SRCFOLDER1234567: "https://drive.google.com/drive/folders/DESTFOLDER" };
  const ok = gas.StdFolders_remapFolderUrl_("https://drive.google.com/drive/folders/SRCFOLDER1234567", folderIdMap);
  assert.equal(ok.status, "remapped");
  assert.equal(ok.value, "https://drive.google.com/drive/folders/DESTFOLDER");

  const cleared = gas.StdFolders_remapFolderUrl_("https://drive.google.com/drive/folders/OTHERFOLDER9999", folderIdMap);
  assert.equal(cleared.status, "cleared");
  assert.equal(cleared.value, "");
});

test("StdFolders_walkFields_: ネストした children も全て訪問する", () => {
  const gas = loadGasContext();
  const schema = [
    { label: "a", children: [{ label: "a1" }, { label: "a2", children: [{ label: "a2x" }] }] },
    { label: "b" },
  ];
  const seen = [];
  gas.StdFolders_walkFields_(schema, (f) => seen.push(f.label));
  assert.deepEqual(seen.sort(), ["a", "a1", "a2", "a2x", "b"]);
});

test("NFB_STD_FOLDER_NAMES / ORDER: 8 種の標準フォルダ名を網羅する", () => {
  const gas = loadGasContext();
  assert.equal(gas.NFB_STD_FOLDER_ORDER.length, 8);
  assert.equal(gas.NFB_STD_FOLDER_NAMES.forms, "01_forms");
  assert.equal(gas.NFB_STD_FOLDER_NAMES.documents, "08_documents");
  // ORDER の全キーが NAMES に存在する
  for (const key of gas.NFB_STD_FOLDER_ORDER) {
    assert.ok(gas.NFB_STD_FOLDER_NAMES[key], "missing name for " + key);
  }
});

test("StdFolders_writeRebuildMarker_: マーカーを 1 件だけ作成し sourceRootId を埋め込む", () => {
  const gas = loadGasContext();
  const dest = makeMockFolder("DEST");
  gas.StdFolders_writeRebuildMarker_(dest, "SRCROOT");
  assert.equal(dest._files.length, 1);
  const f = dest._files[0];
  assert.equal(f._name, gas.NFB_STD_REBUILD_MARKER_NAME);
  const meta = JSON.parse(f._content);
  assert.equal(meta.sourceRootId, "SRCROOT");
  assert.equal(meta.version, 1);
});

test("StdFolders_writeRebuildMarker_: 既存マーカーがあれば作り直さない", () => {
  const gas = loadGasContext();
  const dest = makeMockFolder("DEST");
  gas.StdFolders_writeRebuildMarker_(dest, "SRC1");
  gas.StdFolders_writeRebuildMarker_(dest, "SRC2");
  assert.equal(dest._files.length, 1);
  // 1 件目のまま（上書きされない）
  assert.equal(JSON.parse(dest._files[0]._content).sourceRootId, "SRC1");
});

test("StdFolders_findRebuildMarker_: 非存在は null / ゴミ箱はスキップ / 有効な 1 件を返す", () => {
  const gas = loadGasContext();
  const dest = makeMockFolder("DEST");
  assert.equal(gas.StdFolders_findRebuildMarker_(dest), null);
  gas.StdFolders_writeRebuildMarker_(dest, "SRC");
  const marker = gas.StdFolders_findRebuildMarker_(dest);
  assert.ok(marker);
  marker.setTrashed(true);
  assert.equal(gas.StdFolders_findRebuildMarker_(dest), null);
});

// consume: 内部の resolveRootFolder_ / rebuild* を VM グローバル上書きで差し替えて検証する。
function setupConsume(gas, { root, calls }) {
  gas.StdFolders_resolveRootFolder_ = () => root;
  gas.StdFolders_rebuildFormsMapping_ = () => { calls.push("forms"); return { count: 2 }; };
  gas.StdFolders_rebuildAnalyticsMapping_ = (r, type) => { calls.push(type); return { count: 1 }; };
}

test("StdFolders_consumePendingRebuild_: マーカー有り → 再構築実行＋マーカー削除＋ran:true", () => {
  const gas = loadGasContext();
  const root = makeMockFolder("DESTROOT");
  gas.StdFolders_writeRebuildMarker_(root, "SRCROOT"); // sourceRootId != root.getId()
  const calls = [];
  setupConsume(gas, { root, calls });

  const res = gas.StdFolders_consumePendingRebuild_();
  assert.equal(res.ran, true);
  assert.equal(res.forms.count, 2);
  assert.deepEqual(calls, ["forms", "questions", "dashboards"]);
  // マーカーはゴミ箱に入る
  assert.equal(gas.StdFolders_findRebuildMarker_(root), null);
});

test("StdFolders_consumePendingRebuild_: マーカー無し → ran:false（再構築しない）", () => {
  const gas = loadGasContext();
  const root = makeMockFolder("DESTROOT");
  const calls = [];
  setupConsume(gas, { root, calls });

  const res = gas.StdFolders_consumePendingRebuild_();
  assert.equal(res.ran, false);
  assert.deepEqual(calls, []);
});

test("StdFolders_consumePendingRebuild_: 同一ルート → skipped かつ再構築しない（破壊防止）", () => {
  const gas = loadGasContext();
  const root = makeMockFolder("SAMEROOT");
  gas.StdFolders_writeRebuildMarker_(root, "SAMEROOT"); // sourceRootId === root.getId()
  const calls = [];
  setupConsume(gas, { root, calls });

  const res = gas.StdFolders_consumePendingRebuild_();
  assert.equal(res.ran, false);
  assert.equal(res.skipped, "same-root");
  assert.deepEqual(calls, []);
  // マーカーは削除される
  assert.equal(gas.StdFolders_findRebuildMarker_(root), null);
});
