// Phase 2: Script Properties 最小化の検証。
// forms / analytics の mapping を save→get ラウンドトリップし、
//   ・永続化 JSON に driveFileUrl が含まれない（最小化）
//   ・読取で driveFileUrl が fileId から復元される
//   ・fileId / 名前（title|name）/ folder（論理パスアンカー）は維持される
// を確認する。PropertiesService はインメモリ stub。
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

function loadCtx() {
  const store = {}; // PropertiesService バックエンド
  const props = {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = v; },
  };
  const context = {
    console,
    Logger: { log() {} },
    JSON,
    PropertiesService: {
      getUserProperties: () => props,
      getScriptProperties: () => props,
    },
    // 論理パス正規化（本体は formsFolderStore.gs。ここでは軽量 shim）。
    Forms_normalizeFolderPath_: (raw) =>
      typeof raw !== "string" ? "" : raw.split("/").map((s) => String(s).trim()).filter(Boolean).join("/"),
    nfbErrorToString_: (err) => String((err && err.message) || err),
    _store: store,
  };
  loadGasFiles(context, ["constants.gs", "properties.gs", "formsMappingStore.gs", "analyticsApi.gs"]);
  return context;
}

test("forms mapping: 保存 JSON に driveFileUrl を含めず、読取で fileId から復元する", () => {
  const gas = loadCtx();
  gas.Forms_saveMapping_({
    F1: { fileId: "F1", driveFileUrl: "https://drive.google.com/file/d/F1/view", title: "親フォーム", folder: "01_forms/sub" },
  });

  // 永続化された生 JSON に driveFileUrl は無い（最小化）。
  const raw = JSON.parse(gas._store[gas.FORMS_PROPERTY_KEY]);
  assert.equal(raw.version, gas.FORMS_PROPERTY_VERSION);
  assert.equal("driveFileUrl" in raw.mapping.F1, false, "保存値に driveFileUrl を残さない");
  assert.equal(raw.mapping.F1.fileId, "F1");
  assert.equal(raw.mapping.F1.title, "親フォーム");
  assert.equal(raw.mapping.F1.folder, "01_forms/sub");

  // 読取は driveFileUrl を fileId から復元する。
  const got = gas.Forms_getMapping_();
  assert.equal(got.F1.driveFileUrl, "https://drive.google.com/file/d/F1/view");
  assert.equal(got.F1.title, "親フォーム");
  assert.equal(got.F1.folder, "01_forms/sub");
});

for (const type of ["questions", "dashboards"]) {
  test(`analytics(${type}) mapping: 保存 JSON に driveFileUrl を含めず、読取で復元する`, () => {
    const gas = loadCtx();
    gas.Analytics_saveMapping_(type, {
      Q1: { fileId: "Q1", driveFileUrl: "https://drive.google.com/file/d/Q1/view", name: "集計", folder: "02_questions/x" },
    });

    const key = gas.Analytics_getPropertyKey_(type);
    const raw = JSON.parse(gas._store[key]);
    assert.equal(raw.version, gas.ANALYTICS_MAPPING_VERSION);
    assert.equal("driveFileUrl" in raw.mapping.Q1, false, "保存値に driveFileUrl を残さない");
    assert.equal(raw.mapping.Q1.fileId, "Q1");
    assert.equal(raw.mapping.Q1.name, "集計");
    assert.equal(raw.mapping.Q1.folder, "02_questions/x");

    const got = gas.Analytics_getMapping_(type);
    assert.equal(got.Q1.driveFileUrl, "https://drive.google.com/file/d/Q1/view");
    assert.equal(got.Q1.name, "集計");
    assert.equal(got.Q1.folder, "02_questions/x");
  });
}

test("version は 2 据え置き（後方互換）", () => {
  const gas = loadCtx();
  assert.equal(gas.FORMS_PROPERTY_VERSION, 2);
  assert.equal(gas.ANALYTICS_MAPPING_VERSION, 2);
});
