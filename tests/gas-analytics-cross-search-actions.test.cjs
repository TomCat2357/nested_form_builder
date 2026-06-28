/**
 * 串刺しフォーム検索（cross-form search = type "crossSearches"）の GAS バックエンドが
 * Question / Dashboard と同じ汎用テンプレ層で save / get / list / copy / import を扱えることを検証。
 *
 * gas-analytics-template-actions.test.cjs と同じ in-memory Drive / Properties モックを使い、
 * crossSearches 専用の drivemap キーを ctx へ注入する。
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

function loadAnalyticsContext() {
  const fileStore = new Map();
  const folderStore = new Map();
  let nextFileId = 1;
  let nextFolderId = 1;
  let nextUlid = 1;

  const makeFile = ({ name, parentId = null, content = "", mimeType = "text/plain", trashed = false }) => {
    const id = `file_${nextFileId++}`;
    const file = { id, name, parentId, content, trashed, mimeType };
    fileStore.set(id, file);
    return file;
  };
  const makeFolder = ({ name, parentId = null }) => {
    const id = `folder_${nextFolderId++}`;
    const folder = { id, name, parentId };
    folderStore.set(id, folder);
    return folder;
  };

  const fileWrapper = (file) => ({
    getId: () => file.id,
    getName: () => file.name,
    setName: (n) => { file.name = n; },
    getUrl: () => `https://drive.google.com/file/d/${file.id}/view`,
    getMimeType: () => file.mimeType,
    isTrashed: () => file.trashed,
    setContent: (c) => { file.content = c; },
    setTrashed: (v) => { file.trashed = v; },
    getBlob: () => ({ getDataAsString: () => file.content }),
    makeCopy: (name, destFolder) => fileWrapper(makeFile({
      name, parentId: destFolder.getId(), content: file.content, mimeType: file.mimeType,
    })),
    getParents: () => {
      const parents = [];
      if (file.parentId) {
        const f = folderStore.get(file.parentId);
        if (f) parents.push(folderWrapper(f));
      }
      let i = 0;
      return { hasNext: () => i < parents.length, next: () => parents[i++] };
    },
  });
  const folderWrapper = (folder) => ({
    getId: () => folder.id,
    getName: () => folder.name,
    createFile: (name, content, mimeType) => fileWrapper(makeFile({ name, parentId: folder.id, content, mimeType: mimeType || "text/plain" })),
    createFolder: (name) => folderWrapper(makeFolder({ name, parentId: folder.id })),
    getFoldersByName: (name) => {
      const matches = Array.from(folderStore.values()).filter((f) => f.parentId === folder.id && f.name === name);
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => folderWrapper(matches[i++]) };
    },
    getFiles: () => {
      const matches = Array.from(fileStore.values()).filter((f) => f.parentId === folder.id && !f.trashed);
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => fileWrapper(matches[i++]) };
    },
    getFilesByName: (name) => {
      const matches = Array.from(fileStore.values()).filter((f) => f.parentId === folder.id && f.name === name && !f.trashed);
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => fileWrapper(matches[i++]) };
    },
    getFolders: () => {
      const matches = Array.from(folderStore.values()).filter((f) => f.parentId === folder.id);
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => folderWrapper(matches[i++]) };
    },
  });

  const DriveApp = {
    createFolder: (name) => folderWrapper(makeFolder({ name, parentId: null })),
    createFile: (name, content, mimeType) => fileWrapper(makeFile({ name, parentId: null, content, mimeType: mimeType || "text/plain" })),
    getFileById: (id) => {
      const f = fileStore.get(id);
      if (!f) throw new Error("file not found: " + id);
      return fileWrapper(f);
    },
    getFolderById: (id) => {
      const f = folderStore.get(id);
      if (!f) throw new Error("folder not found: " + id);
      return folderWrapper(f);
    },
    getFoldersByName: (name) => {
      const matches = Array.from(folderStore.values()).filter((f) => f.parentId === null && f.name === name);
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => folderWrapper(matches[i++]) };
    },
  };

  const propsStore = new Map();
  const propsService = {
    getProperty: (key) => propsStore.has(key) ? propsStore.get(key) : null,
    setProperty: (key, value) => propsStore.set(key, value),
    deleteProperty: (key) => propsStore.delete(key),
  };

  const stdRootFolder = makeFolder({ name: "NFB Root", parentId: null });
  const scriptFile = makeFile({ name: "appsscript", parentId: stdRootFolder.id, content: "", mimeType: "application/vnd.google-apps.script" });
  const ScriptApp = { getScriptId: () => scriptFile.id };

  const ctx = {
    console,
    Logger: { log: () => {} },
    DriveApp,
    ScriptApp,
    MimeType: { PLAIN_TEXT: "text/plain" },
    PropertiesService: { getScriptProperties: () => propsService, getUserProperties: () => propsService },
    Nfb_getScriptProperties_: () => propsService,
    JSON,
    Date,
    String,
    Object,
    Array,
    Error,
    isNaN,
    parseInt,
    Number,
    Nfb_getActiveProperties_: () => propsService,
    Nfb_trimStr_: (value) => (value ? String(value).trim() : ""),
    Forms_normalizeFolderPath_: (raw) => (typeof raw !== "string" ? "" :
      raw.split("/").map((s) => String(s).trim()).filter((s) => s.length > 0).join("/")),
    NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION: 1,
    NFB_ANALYTICS_QUESTIONS_FOLDER_DRIVE_MAP_KEY: "nfb.analytics.questions.folders.drivemap",
    NFB_ANALYTICS_DASHBOARDS_FOLDER_DRIVE_MAP_KEY: "nfb.analytics.dashboards.folders.drivemap",
    NFB_ANALYTICS_CROSSSEARCHES_FOLDER_DRIVE_MAP_KEY: "nfb.analytics.crossSearches.folders.drivemap",
    Nfb_generateUlid_: () => `ulid${String(nextUlid++).padStart(10, "0")}`,
    Nfb_parseVersionedMapping_: (json, expectedVersion) => {
      if (!json) return {};
      try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        if (parsed.version !== expectedVersion) return {};
        if (!parsed.mapping || typeof parsed.mapping !== "object" || Array.isArray(parsed.mapping)) return {};
        return parsed.mapping;
      } catch (_e) {
        return {};
      }
    },
    Nfb_normalizeIdList_: (ids) => {
      const source = Array.isArray(ids) ? ids : [ids];
      const seen = {};
      const out = [];
      for (const raw of source) {
        if (!raw) continue;
        const id = String(raw);
        if (seen[id]) continue;
        seen[id] = true;
        out.push(id);
      }
      return out;
    },
    nfbSafeCall_: (fn) => {
      try { return fn(); } catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
    },
    WithScriptLock_: (label, fn) => fn(),
    nfbErrorToString_: (err) => err && err.message ? err.message : String(err),
    Nfb_serializeVersionedMapping_: (props, key, version, mapping, normalizeFn) => {
      const normalized = {};
      for (const id in mapping) {
        if (!Object.prototype.hasOwnProperty.call(mapping, id)) continue;
        normalized[id] = normalizeFn(mapping[id] || {});
      }
      props.setProperty(key, JSON.stringify({ version: version, mapping: normalized }));
      return normalized;
    },
    Nfb_resolveFileIdFromEntry_: (entry) => {
      if (!entry) return null;
      if (entry.fileId) return entry.fileId;
      return null;
    },
    Nfb_dedupeMappingByFileId_: (mapping) => {
      const keepFor = {};
      const toDelete = [];
      for (const k in mapping) {
        if (!Object.prototype.hasOwnProperty.call(mapping, k)) continue;
        const fid = ctx.Nfb_resolveFileIdFromEntry_(mapping[k]);
        if (!fid) continue;
        const cur = keepFor[fid];
        if (cur === undefined) { keepFor[fid] = k; continue; }
        if (k === fid && cur !== fid) { toDelete.push(cur); keepFor[fid] = k; }
        else { toDelete.push(k); }
      }
      for (let i = 0; i < toDelete.length; i++) delete mapping[toDelete[i]];
      return toDelete.length > 0;
    },
    Nfb_nameFromFileName_: (fileName) => (fileName == null ? "" : String(fileName)).replace(/\.json$/i, ""),
    Nfb_nameFromFile_: (file) => {
      try { return (file.getName() == null ? "" : String(file.getName())).replace(/\.json$/i, ""); } catch (e) { return ""; }
    },
  };

  vm.createContext(ctx);
  ctx.Nfb_withLockedSafeCall_ = (label, fn) => ctx.nfbSafeCall_(() => ctx.WithScriptLock_(label, fn));

  const projectRoot = path.join(__dirname, "..");
  const filesToLoad = [
    "gas/formsParsing.gs",
    "gas/formsTitleHelpers.js",
    "gas/formsMappingStore.gs",
    "gas/analyticsApi.gs",
    "gas/sharedEntityCrud.gs",
    "gas/analyticsCrud.gs",
    "gas/analyticsImport.gs",
    "gas/analyticsCopy.gs",
    "gas/sharedDriveFolders.gs",
    "gas/formsDriveFolders.gs",
    "gas/analyticsDriveFolders.gs",
    "gas/standardFolders.gs",
    "gas/standardFoldersAlign.gs",
    "gas/standardFoldersAlignRefs.gs",
  ];
  for (const rel of filesToLoad) {
    const fullPath = path.join(projectRoot, rel);
    vm.runInContext(fs.readFileSync(fullPath, "utf8"), ctx, { filename: fullPath });
  }

  ctx.__test = { fileStore, folderStore, propsStore, makeFile, makeFolder, stdRootFolder };
  return ctx;
}

const CFS_MAPPING_KEY = "nfb.analytics.crossSearches.mapping";

test("crossSearches: save は専用 mapping / 標準フォルダ 09_cross_searches に保存し formIds/columns を保持する", () => {
  const ctx = loadAnalyticsContext();
  const payload = {
    name: "申込・問合せ横断",
    formIds: ["formA", "formB"],
    columns: [{ path: "氏名", label: "氏名", type: "text" }],
  };
  const saved = ctx.Analytics_saveTemplate_("crossSearches", payload);
  assert.equal(saved.ok, true);
  assert.equal(saved.saveMode, "copy_to_root");
  // 結果キーは crossSearch
  assert.ok(saved.crossSearch, "result key is crossSearch");
  assert.deepEqual(saved.crossSearch.formIds, ["formA", "formB"]);
  assert.equal(saved.crossSearch.columns.length, 1);

  // 専用 mapping キーに登録される
  const mappingDoc = JSON.parse(ctx.__test.propsStore.get(CFS_MAPPING_KEY));
  const fileId = mappingDoc.mapping[saved.crossSearch.id].fileId;
  assert.ok(fileId);
  // 標準ルート配下の 09_cross_searches に置かれる
  const file = ctx.__test.fileStore.get(fileId);
  const parent = ctx.__test.folderStore.get(file.parentId);
  assert.equal(parent.name, "09_cross_searches");
  assert.equal(parent.parentId, ctx.__test.stdRootFolder.id);
  // questions / dashboards の mapping は作られない（型が混ざらない）
  assert.equal(ctx.__test.propsStore.has("nfb.analytics.questions.mapping"), false);
  assert.equal(ctx.__test.propsStore.has("nfb.analytics.dashboards.mapping"), false);
});

test("crossSearches: get / list が保存内容を返し、archived フィルタが効く", () => {
  const ctx = loadAnalyticsContext();
  const a = ctx.Analytics_saveTemplate_("crossSearches", { name: "active", formIds: ["f1"], columns: [] });
  ctx.Analytics_saveTemplate_("crossSearches", { name: "archivedOne", archived: true, formIds: ["f1"], columns: [] });

  const got = ctx.Analytics_getTemplate_("crossSearches", a.crossSearch.id);
  assert.equal(got.ok, true);
  assert.equal(got.crossSearch.name, "active");
  // VM 実行コンテキストで生成された配列は JSON 往復で node realm へ正規化してから比較する。
  assert.deepEqual(JSON.parse(JSON.stringify(got.crossSearch.formIds)), ["f1"]);

  const listed = ctx.Analytics_listTemplates_("crossSearches", {});
  const listedNames = JSON.parse(JSON.stringify(listed.crossSearches)).map((c) => c.name);
  assert.deepEqual(listedNames, ["active"]);
  const all = ctx.Analytics_listTemplates_("crossSearches", { includeArchived: true });
  const allNames = JSON.parse(JSON.stringify(all.crossSearches)).map((c) => c.name).sort();
  assert.deepEqual(allNames, ["active", "archivedOne"]);
});

test("crossSearches: copy は `名前 (1)` 形式で複製する", () => {
  const ctx = loadAnalyticsContext();
  const orig = ctx.Analytics_saveTemplate_("crossSearches", { name: "横断", formIds: ["f1"], columns: [] });
  const copyRes = ctx.Analytics_copyTemplate_("crossSearches", orig.crossSearch.id);
  assert.equal(copyRes.ok, true);
  assert.equal(copyRes.crossSearch.name, "横断 (1)");
  assert.notEqual(copyRes.crossSearch.id, orig.crossSearch.id);
});

test("crossSearches: normalizeImportedTemplate は formIds 配列を要求する", () => {
  const ctx = loadAnalyticsContext();
  assert.equal(ctx.Analytics_normalizeImportedTemplate_("crossSearches", { name: "no-formIds" }), null);
  const ok = ctx.Analytics_normalizeImportedTemplate_("crossSearches", { name: "ok", formIds: ["f1"], columns: [] });
  assert.ok(ok);
  assert.equal(ok.archived, false);
});
