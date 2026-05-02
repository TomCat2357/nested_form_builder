const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGasContext() {
  const propStore = new Map();

  const context = {
    console,
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (propStore.has(k) ? propStore.get(k) : null),
        setProperty: (k, v) => { propStore.set(k, v); },
        deleteProperty: (k) => { propStore.delete(k); },
      }),
      getUserProperties: () => ({
        getProperty: (k) => (propStore.has(k) ? propStore.get(k) : null),
        setProperty: (k, v) => { propStore.set(k, v); },
        deleteProperty: (k) => { propStore.delete(k); },
      }),
    },
    Utilities: {
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64").replace(/\//g, "_").replace(/\+/g, "-"),
    },
  };

  vm.createContext(context);

  const projectRoot = path.join(__dirname, "..");
  const filesToLoad = [
    "constants.gs",
    "properties.gs",
    "dashboardsMappingStore.gs",
  ];
  filesToLoad.forEach((fileName) => {
    const sourceFile = path.join(projectRoot, "gas", fileName);
    const code = fs.readFileSync(sourceFile, "utf8");
    vm.runInContext(code, context, { filename: sourceFile });
  });

  return { context, propStore };
}

test("Dashboards_buildDriveFileUrlFromId_ は ID から view URL を組み立てる", () => {
  const { context: gas } = loadGasContext();
  assert.equal(
    gas.Dashboards_buildDriveFileUrlFromId_("file123"),
    "https://drive.google.com/file/d/file123/view",
  );
  assert.equal(gas.Dashboards_buildDriveFileUrlFromId_(""), null);
  assert.equal(gas.Dashboards_buildDriveFileUrlFromId_(null), null);
});

test("Dashboards_normalizeMappingValue_ は fileId と driveFileUrl の両方を補完する", () => {
  const { context: gas } = loadGasContext();
  const result = JSON.parse(JSON.stringify(gas.Dashboards_normalizeMappingValue_({ fileId: "abc" })));
  assert.deepEqual(result, {
    fileId: "abc",
    driveFileUrl: "https://drive.google.com/file/d/abc/view",
  });
});

test("Dashboards_normalizeMappingValue_ は不正な型を null にする", () => {
  const { context: gas } = loadGasContext();
  const result = JSON.parse(JSON.stringify(gas.Dashboards_normalizeMappingValue_("not-an-object")));
  assert.deepEqual(result, { fileId: null, driveFileUrl: null });
});

test("Dashboards_saveMapping_ と Dashboards_getMapping_ はラウンドトリップする", () => {
  const { context: gas } = loadGasContext();
  gas.Dashboards_saveMapping_({ dsh_a: { fileId: "fa" }, dsh_b: { fileId: "fb" } });
  const mapping = JSON.parse(JSON.stringify(gas.Dashboards_getMapping_()));
  assert.equal(mapping.dsh_a.fileId, "fa");
  assert.equal(mapping.dsh_b.fileId, "fb");
  assert.equal(mapping.dsh_a.driveFileUrl, "https://drive.google.com/file/d/fa/view");
});

test("Dashboards_getMapping_ は version 不一致なら空オブジェクトを返す", () => {
  const { context: gas, propStore } = loadGasContext();
  propStore.set(gas.DASHBOARDS_PROPERTY_KEY, JSON.stringify({ version: 999, mapping: { dsh_x: { fileId: "fx" } } }));
  const mapping = JSON.parse(JSON.stringify(gas.Dashboards_getMapping_()));
  assert.deepEqual(mapping, {});
});

test("Dashboards_normalizeIds_ は重複と空値を除外する", () => {
  const { context: gas } = loadGasContext();
  const ids = JSON.parse(JSON.stringify(gas.Dashboards_normalizeIds_(["a", "", "a", "b", null, undefined, "c"])));
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("Dashboards_normalizeIds_ は単一スカラーも配列化する", () => {
  const { context: gas } = loadGasContext();
  const result = JSON.parse(JSON.stringify(gas.Dashboards_normalizeIds_("only")));
  assert.deepEqual(result, ["only"]);
});

test("Nfb_generateDashboardId_ は dsh_ プレフィックスで一意な ID を生成する", () => {
  const { context: gas } = loadGasContext();
  const a = gas.Nfb_generateDashboardId_();
  const b = gas.Nfb_generateDashboardId_();
  assert.notEqual(a, b);
  assert.match(a, /^dsh_/);
});
