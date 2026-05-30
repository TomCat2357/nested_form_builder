/**
 * gas/analyticsApi.gs / analyticsCrud.gs / analyticsImport.gs / analyticsCopy.gs
 * の主要フロー（archive / delete / copy / import / list の archived フィルタ）を検証。
 *
 * GAS API （DriveApp / PropertiesService / MimeType / Logger）と関連ヘルパーを VM に注入する。
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

function loadAnalyticsContext() {
  // ---- in-memory drive ----
  const fileStore = new Map(); // fileId -> { id, name, parentId, content, trashed, mimeType }
  const folderStore = new Map(); // folderId -> { id, name, parentId }
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

  // ---- properties service ----
  const propsStore = new Map();
  const propsService = {
    getProperty: (key) => propsStore.has(key) ? propsStore.get(key) : null,
    setProperty: (key, value) => propsStore.set(key, value),
    deleteProperty: (key) => propsStore.delete(key),
  };

  // ---- 標準フォルダ構成のルート（appsscript 本体の親フォルダ）----
  // StdFolders_resolveRootFolder_ → detectRootFromScript_ が ScriptApp.getScriptId →
  // DriveApp.getFileById(scriptId).getParents() でルートを解決できるようにする。
  const stdRootFolder = makeFolder({ name: "NFB Root", parentId: null });
  const scriptFile = makeFile({ name: "appsscript", parentId: stdRootFolder.id, content: "", mimeType: "application/vnd.google-apps.script" });
  const ScriptApp = { getScriptId: () => scriptFile.id };

  // ---- vm context ----
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
    // shims (本来は gas/properties.gs / gas/constants.gs にある共通ヘルパー)
    Nfb_getActiveProperties_: () => propsService,
    // 物理フォルダミラー（analyticsDriveFolders.gs）が使う定数・正規化ヘルパ。
    Forms_normalizeFolderPath_: (raw) => (typeof raw !== "string" ? "" :
      raw.split("/").map((s) => String(s).trim()).filter((s) => s.length > 0).join("/")),
    NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION: 1,
    NFB_ANALYTICS_QUESTIONS_FOLDER_DRIVE_MAP_KEY: "nfb.analytics.questions.folders.drivemap",
    NFB_ANALYTICS_DASHBOARDS_FOLDER_DRIVE_MAP_KEY: "nfb.analytics.dashboards.folders.drivemap",
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
      try {
        const result = fn();
        return result;
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    },
    nfbErrorToString_: (err) => err && err.message ? err.message : String(err),
    // 本来は gas/formsCrud.gs / gas/properties.gs にある共通ヘルパー（forms 系を本テストではロードしないため shim）
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
      // テストでは entry.fileId 経由のみ使う想定。URL 経由が必要なら Forms_parseGoogleDriveUrl_ shim を追加する。
      return null;
    },
    // 本来は gas/formsCrud.gs 定義（forms 系をロードしないため shim）。実体と同じ setTrashed ベース。
    Nfb_trashDriveFileById_: (fileId) => {
      if (!fileId) return false;
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
        return true;
      } catch (err) {
        return false;
      }
    },
    // 名前 ＝ Drive ファイル名（.json 除去）。本来は gas/formsCrud.gs 定義（forms 系をロードしないため shim）。
    Nfb_nameFromFileName_: (fileName) => (fileName == null ? "" : String(fileName)).replace(/\.json$/i, ""),
    Nfb_nameFromFile_: (file) => {
      try { return (file.getName() == null ? "" : String(file.getName())).replace(/\.json$/i, ""); } catch (e) { return ""; }
    },
  };

  vm.createContext(ctx);

  const projectRoot = path.join(__dirname, "..");
  const filesToLoad = [
    "gas/formsParsing.gs",
    // Analytics_saveTemplate_ が Forms_makeUniqueFormTitle_ / Forms_normalizeFormTitle_ を呼ぶため事前ロード
    "gas/formsTitleHelpers.js",
    "gas/analyticsApi.gs",
    "gas/analyticsCrud.gs",
    "gas/analyticsImport.gs",
    "gas/analyticsCopy.gs",
    // 物理フォルダミラー（保存/移動/インポート時の物理配置・名前フォールバック解決）に必要。
    // 汎用ヘルパ（FormsDrive_folderByIdOrNull_ など）を流用するため forms 版も先に読み込む。
    "gas/formsDriveFolders.gs",
    "gas/analyticsDriveFolders.gs",
    // import 時の構成内判定 / 構成外コピー（StdFolders_ensureFileInStdFolder_）に必要
    "gas/standardFolders.gs",
  ];
  for (const rel of filesToLoad) {
    const fullPath = path.join(projectRoot, rel);
    const code = fs.readFileSync(fullPath, "utf8");
    vm.runInContext(code, ctx, { filename: fullPath });
  }

  // helpers exposed for tests
  ctx.__test = {
    fileStore,
    folderStore,
    propsStore,
    fileWrapper,
    folderWrapper,
    makeFile,
    makeFolder,
    stdRootFolder,
  };

  return ctx;
}

// ---- list with archived filter ----

test("Analytics_listTemplates_ は includeArchived=false でアーカイブ項目を除外する", () => {
  const ctx = loadAnalyticsContext();

  // 既定フォルダに2件作成（1件はarchived=true）
  const saveActive = ctx.Analytics_saveTemplate_("questions", { name: "active1", query: { mode: "gui" } });
  assert.equal(saveActive.ok, true);

  const saveArchived = ctx.Analytics_saveTemplate_("questions", { name: "archived1", archived: true, query: { mode: "gui" } });
  assert.equal(saveArchived.ok, true);

  // includeArchived=false（既定）
  const listed = ctx.Analytics_listTemplates_("questions", {});
  assert.equal(listed.ok, true);
  const names = JSON.parse(JSON.stringify(listed.questions)).map((q) => q.name);
  assert.deepEqual(names, ["active1"]);

  // includeArchived=true
  const listedAll = ctx.Analytics_listTemplates_("questions", { includeArchived: true });
  const namesAll = JSON.parse(JSON.stringify(listedAll.questions)).map((q) => q.name).sort();
  assert.deepEqual(namesAll, ["active1", "archived1"]);
});

// ---- archive / unarchive ----

test("Analytics_setTemplatesArchivedState_ は archived フラグを反転して再保存する", () => {
  const ctx = loadAnalyticsContext();

  const saved = ctx.Analytics_saveTemplate_("questions", { name: "q1", query: { mode: "gui" } });
  const id = saved.question.id;

  // archive
  const arc = ctx.Analytics_setTemplatesArchivedState_("questions", [id], true);
  assert.equal(arc.ok, true);
  assert.equal(arc.updated, 1);
  assert.equal(arc.questions[0].archived, true);

  // 単一取得でも archived=true が返ること
  const got = ctx.Analytics_getTemplate_("questions", id);
  assert.equal(got.question.archived, true);

  // unarchive
  const unar = ctx.Analytics_setTemplatesArchivedState_("questions", [id], false);
  assert.equal(unar.ok, true);
  assert.equal(unar.questions[0].archived, false);
});

// ---- delete: mapping removed and drive file trashed ----

test("Analytics_deleteTemplates_ はマッピングを除去し Drive ファイルもゴミ箱へ移す", () => {
  const ctx = loadAnalyticsContext();

  const saved = ctx.Analytics_saveTemplate_("dashboards", { name: "d1", cards: [] });
  const id = saved.dashboard.id;
  const fileId = ctx.__test.propsStore.has("nfb.analytics.dashboards.mapping")
    ? JSON.parse(ctx.__test.propsStore.get("nfb.analytics.dashboards.mapping")).mapping[id].fileId
    : null;
  assert.ok(fileId, "mapping has fileId");

  // delete
  const del = ctx.Analytics_deleteTemplates_("dashboards", [id]);
  assert.equal(del.ok, true);
  assert.equal(del.deleted, 1);

  // mapping から消えている
  const mapping = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.dashboards.mapping")).mapping;
  assert.ok(!mapping[id], "mapping deleted");

  // Drive ファイル自体もゴミ箱へ移されている（trashed=true）
  const file = ctx.__test.fileStore.get(fileId);
  assert.ok(file, "drive file record still exists in store");
  assert.equal(file.trashed, true, "drive file IS trashed");
});

// ---- copy ----

test("Analytics_copyTemplate_ は同じフォルダに `名前 (1)` 形式で複製する", () => {
  const ctx = loadAnalyticsContext();

  // 親フォルダを作って、その中に保存
  const parent = ctx.__test.makeFolder({ name: "MyAnalyticsFolder", parentId: null });
  const folderUrl = `https://drive.google.com/drive/folders/${parent.id}`;
  const orig = ctx.Analytics_saveTemplate_("questions", { name: "orig", query: { mode: "gui" } }, folderUrl);
  assert.equal(orig.ok, true);
  assert.equal(orig.saveMode, "copy_to_folder");

  const origFileId = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.questions.mapping")).mapping[orig.question.id].fileId;
  const origParentId = ctx.__test.fileStore.get(origFileId).parentId;
  assert.equal(origParentId, parent.id);

  // 1 回目のコピー: 名前は `orig (1)` で採番される
  const copyRes = ctx.Analytics_copyTemplate_("questions", orig.question.id);
  assert.equal(copyRes.ok, true);
  assert.equal(copyRes.question.name, "orig (1)");
  assert.equal(copyRes.question.archived, false);
  assert.notEqual(copyRes.question.id, orig.question.id);

  const copyFileId = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.questions.mapping")).mapping[copyRes.question.id].fileId;
  const copyParentId = ctx.__test.fileStore.get(copyFileId).parentId;
  assert.equal(copyParentId, parent.id, "copy lands in same folder as original");

  // 2 回目のコピー: 名前は `orig (2)` で採番される
  const copyRes2 = ctx.Analytics_copyTemplate_("questions", orig.question.id);
  assert.equal(copyRes2.ok, true);
  assert.equal(copyRes2.question.name, "orig (2)");
});

// ---- import / register ----

test("Analytics import (④): 構成外のファイルは 02_questions へコピーしてリンクする", () => {
  const ctx = loadAnalyticsContext();

  // 標準フォルダ構成の外（ルート直下の別フォルダ）にインポート対象を配置
  const externalFolder = ctx.__test.makeFolder({ name: "ExternalQuestions", parentId: null });
  const validQuestion = { name: "imported_q", query: { mode: "sql" } };
  const externalFile = ctx.__test.makeFile({
    name: "imported.json",
    parentId: externalFolder.id,
    content: JSON.stringify(validQuestion),
    mimeType: "application/json",
  });

  const importRes = ctx.Analytics_importFromDrive_("questions", `https://drive.google.com/drive/folders/${externalFolder.id}`);
  assert.equal(importRes.ok, true);
  assert.equal(importRes.items.length, 1);

  const reg = ctx.Analytics_registerImportedTemplate_("questions", importRes.items[0]);
  assert.equal(reg.ok, true);
  assert.notEqual(reg.fileId, externalFile.id, "構成外なのでコピーされ新しい fileId になる");

  // コピー先は標準ルート配下の 02_questions
  const copied = ctx.__test.fileStore.get(reg.fileId);
  const sub = ctx.__test.folderStore.get(copied.parentId);
  assert.equal(sub.name, "02_questions");
  assert.equal(sub.parentId, ctx.__test.stdRootFolder.id);

  // mapping はコピー先 fileId を指す
  const mapping = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.questions.mapping")).mapping;
  assert.equal(mapping[reg.question.id].fileId, reg.fileId);
});

test("Analytics import (④): 構成内 (02_questions) のファイルは参照のまま登録する", () => {
  const ctx = loadAnalyticsContext();

  // 標準ルート配下の 02_questions にインポート対象を配置
  const sub = ctx.__test.folderWrapper(ctx.__test.stdRootFolder).createFolder("02_questions");
  const insideFile = ctx.__test.makeFile({
    name: "inside.json",
    parentId: sub.getId(),
    content: JSON.stringify({ name: "inside_q", query: { mode: "sql" } }),
    mimeType: "application/json",
  });

  const importRes = ctx.Analytics_importFromDrive_("questions", `https://drive.google.com/drive/folders/${sub.getId()}`);
  assert.equal(importRes.items.length, 1);

  const reg = ctx.Analytics_registerImportedTemplate_("questions", importRes.items[0]);
  assert.equal(reg.ok, true);
  assert.equal(reg.fileId, insideFile.id, "構成内なのでコピーせず参照のまま");
});

test("Analytics_normalizeImportedTemplate_ は不正な JSON を null で拒否する", () => {
  const ctx = loadAnalyticsContext();

  // questions: query が無いものは null
  assert.equal(ctx.Analytics_normalizeImportedTemplate_("questions", { name: "no-query" }), null);
  assert.equal(ctx.Analytics_normalizeImportedTemplate_("questions", null), null);

  // questions: query が object なら正規化
  const ok = ctx.Analytics_normalizeImportedTemplate_("questions", { name: "q", query: { mode: "gui" } });
  assert.ok(ok);
  assert.equal(ok.archived, false);

  // dashboards: cards が array でなければ null
  assert.equal(ctx.Analytics_normalizeImportedTemplate_("dashboards", { name: "no-cards" }), null);
  const okD = ctx.Analytics_normalizeImportedTemplate_("dashboards", { name: "d", cards: [] });
  assert.ok(okD);
});

// ---- save: targetUrl folder mode ----

test("Analytics_saveTemplate_ は targetUrl にフォルダ URL を渡すと copy_to_folder で動作する", () => {
  const ctx = loadAnalyticsContext();

  const folder = ctx.__test.makeFolder({ name: "X", parentId: null });
  const url = `https://drive.google.com/drive/folders/${folder.id}`;
  const res = ctx.Analytics_saveTemplate_("questions", { name: "q", query: { mode: "gui" } }, url);
  assert.equal(res.ok, true);
  assert.equal(res.saveMode, "copy_to_folder");
  const fileId = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.questions.mapping")).mapping[res.question.id].fileId;
  assert.equal(ctx.__test.fileStore.get(fileId).parentId, folder.id);
});

test("Analytics_saveTemplate_ は targetUrl 無し / 既存マッピング無しなら標準フォルダ 02_questions に保存する (①)", () => {
  const ctx = loadAnalyticsContext();
  const res = ctx.Analytics_saveTemplate_("questions", { name: "q", query: { mode: "gui" } });
  assert.equal(res.ok, true);
  assert.equal(res.saveMode, "copy_to_root");
  const fileId = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.questions.mapping")).mapping[res.question.id].fileId;
  const file = ctx.__test.fileStore.get(fileId);
  // 標準フォルダ構成が常に基本のため、親が標準ルート配下の 02_questions であること
  const parent = ctx.__test.folderStore.get(file.parentId);
  assert.equal(parent.name, "02_questions");
  assert.equal(parent.parentId, ctx.__test.stdRootFolder.id);
});

test("Analytics_saveTemplate_ は新規保存で id ＝ 作成ファイルの fileId を採用し、.json に id/name を書かない", () => {
  const ctx = loadAnalyticsContext();
  const res = ctx.Analytics_saveTemplate_("questions", { name: "新規Q", query: { mode: "gui" } });
  assert.equal(res.ok, true);

  // 返却 id ＝ マッピングの fileId ＝ 実ファイルの fileId。
  const mapping = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.questions.mapping")).mapping;
  const fileId = mapping[res.question.id].fileId;
  assert.equal(res.question.id, fileId, "id ＝ Drive fileId");

  // ファイル名 ＝ 名前 + .json。
  assert.equal(ctx.__test.fileStore.get(fileId).name, "新規Q.json");

  // .json は自分自身の id も名前も持たない。
  const content = JSON.parse(ctx.__test.fileStore.get(fileId).content);
  assert.equal(content.id, undefined);
  assert.equal(content.name, undefined);

  // 取得時はファイル名から name、fileId から id を注入する。
  const got = ctx.Analytics_getTemplate_("questions", fileId);
  assert.equal(got.question.id, fileId);
  assert.equal(got.question.name, "新規Q");
});

test("Analytics_saveTemplate_ は2回目以降の保存で既存ファイルを上書きする (overwrite_existing)", () => {
  const ctx = loadAnalyticsContext();
  const first = ctx.Analytics_saveTemplate_("questions", { name: "q", query: { mode: "gui" } });
  const id = first.question.id;
  const fileId1 = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.questions.mapping")).mapping[id].fileId;
  const initialFileName = ctx.__test.fileStore.get(fileId1).name;

  // 2 回目（同じ id を渡して更新）
  const second = ctx.Analytics_saveTemplate_("questions", { id, name: "q-renamed", query: { mode: "gui" } });
  assert.equal(second.saveMode, "overwrite_existing");
  const fileId2 = JSON.parse(ctx.__test.propsStore.get("nfb.analytics.questions.mapping")).mapping[id].fileId;
  assert.equal(fileId2, fileId1, "same fileId is reused");

  const content = JSON.parse(ctx.__test.fileStore.get(fileId2).content);
  // .json は自分自身の id も名前も持たない運用: id / name は書き込まれない。
  assert.equal(content.id, undefined);
  assert.equal(content.name, undefined);

  // 名前 ＝ Drive ファイル名。名前を変えたら Drive ファイル名も追従する（uniqueName.json へリネーム）。
  assert.notEqual(initialFileName, "q-renamed.json");
  assert.equal(ctx.__test.fileStore.get(fileId2).name, "q-renamed.json");
  // 取得時はファイル名から name を導出する。
  const got = ctx.Analytics_getTemplate_("questions", id);
  assert.equal(got.question.name, "q-renamed");
  assert.equal(got.question.id, fileId2);
});

// ---- resolveQuestionRef (リンク切れ時の再リンク) ----

const QUESTIONS_MAPPING_KEY = "nfb.analytics.questions.mapping";

function breakQuestionMapping(ctx, id) {
  const doc = JSON.parse(ctx.__test.propsStore.get(QUESTIONS_MAPPING_KEY));
  delete doc.mapping[id];
  ctx.__test.propsStore.set(QUESTIONS_MAPPING_KEY, JSON.stringify(doc));
}

test("Analytics_resolveQuestionRef_ は参照 fileId が死んでいても name でファイルを探して再リンクする", () => {
  const ctx = loadAnalyticsContext();
  const saved = ctx.Analytics_saveTemplate_("questions", { name: "売上集計", query: { mode: "gui" } });
  const liveFileId = saved.question.id; // id ＝ fileId
  breakQuestionMapping(ctx, liveFileId);

  // 参照 id は存在しない fileId（＝壊れたリンク）。name で 02_questions を探して再リンクする。
  const res = ctx.Analytics_resolveQuestionRef_({ questionId: "DEAD_FILE_ID", name: "売上集計" });
  assert.equal(res.ok, true);
  assert.ok(res.question, "question を返す");
  assert.equal(res.question.name, "売上集計");
  assert.equal(res.relinked, true);
  assert.equal(res.matchedBy, "name");
  // 再リンク後の id ＝ 生存ファイルの fileId。
  assert.equal(res.questionId, liveFileId);
  const restored = JSON.parse(ctx.__test.propsStore.get(QUESTIONS_MAPPING_KEY)).mapping;
  assert.ok(restored[liveFileId], "mapping が復元される");
});

test("Analytics_resolveQuestionRef_ は id（fileId）が生存していればファイル名に依存せず id で解決する", () => {
  const ctx = loadAnalyticsContext();
  const saved = ctx.Analytics_saveTemplate_("questions", { name: "orig", query: { mode: "gui" } });
  const fileId = saved.question.id; // id ＝ fileId
  // フォルダ内での手動改名を模擬（ファイル名を変える）＋ マッピング破壊。id（fileId）は生存。
  ctx.__test.fileStore.get(fileId).name = "totally-different.json";
  breakQuestionMapping(ctx, fileId);

  const res = ctx.Analytics_resolveQuestionRef_({ questionId: fileId, name: "no-such-name" });
  assert.equal(res.ok, true);
  assert.ok(res.question, "question を返す");
  assert.equal(res.matchedBy, "id");
  assert.equal(res.questionId, fileId);
  // 名前はファイル名から導出される。
  assert.equal(res.question.name, "totally-different");
});

test("Analytics_resolveQuestionRef_ は見つからなければ question:null を返す", () => {
  const ctx = loadAnalyticsContext();
  ctx.Analytics_saveTemplate_("questions", { name: "exists", query: { mode: "gui" } });

  const res = ctx.Analytics_resolveQuestionRef_({ questionId: "q_missing", name: "missing" });
  assert.equal(res.ok, true);
  assert.equal(res.question, null);
});
