/**
 * gas/formsStorage.gs の Forms_saveForm_（新規作成 / 上書き / リネーム）を、インメモリ Drive モックで検証する。
 *
 * 重点は「リネーム時に別ファイルを新規作成して二重化しないこと」。フロントの cache 優先取得が
 * 渡す stale な id（実体とずれた fileId / 旧 f_... ULID / mapping から消えたキー）でも、
 * Forms_resolveFormFileOrNull_（fileId → 実体URL → 中央辞書 folder+title アンカー）で実体を
 * 引き当てて setName 上書きへ倒すことを保証する。
 *
 * GAS API（DriveApp / SpreadsheetApp / PropertiesService / Logger）と、本テストでロードしない
 * 周辺ヘルパ（Sheets_ 日時 / 物理フォルダミラー / 標準フォルダ / properties / errors）を shim する。
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

const SS_URL = "https://docs.google.com/spreadsheets/d/SS_TEST_0001/edit";

function loadFormsSaveContext() {
  // ---- in-memory drive ----
  const fileStore = new Map(); // fileId -> { id, name, parentId, content, trashed }
  const folderStore = new Map(); // folderId -> { id, name, parentId }
  let nextFileId = 1;
  let nextFolderId = 1;

  const makeFile = ({ name, parentId = null, content = "" }) => {
    const id = `file_${nextFileId++}`;
    const file = { id, name, parentId, content, trashed: false };
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
    // Forms_parseGoogleDriveUrl_ が再パースできる形にする（driveFileUrl 救済の検証に必須）。
    getUrl: () => `https://drive.google.com/file/d/${file.id}/view`,
    isTrashed: () => file.trashed,
    setContent: (c) => { file.content = c; },
    setTrashed: (v) => { file.trashed = !!v; },
    getBlob: () => ({ getDataAsString: () => file.content }),
  });
  const folderWrapper = (folder) => ({
    getId: () => folder.id,
    getName: () => folder.name,
    createFile: (name, content) => fileWrapper(makeFile({ name, parentId: folder.id, content })),
  });

  const DriveApp = {
    createFile: (name, content) => fileWrapper(makeFile({ name, parentId: null, content })),
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
  };

  // ---- properties service（versioned mapping を JSON で保持）----
  const propsStore = new Map();
  const propsService = {
    getProperty: (k) => (propsStore.has(k) ? propsStore.get(k) : null),
    setProperty: (k, v) => propsStore.set(k, v),
    deleteProperty: (k) => propsStore.delete(k),
  };

  const normalizePath = (raw) => (typeof raw !== "string" ? "" :
    raw.split("/").map((s) => String(s).trim()).filter((s) => s.length > 0).join("/"));

  const context = {
    console,
    Logger: { log: () => {} },
    JSON, Date, String, Object, Array, Error, isNaN, parseInt, Number, RegExp,
    DriveApp,
    // 既存スプレッドシート指定（/spreadsheets/d/ URL）の解決だけ通す。create は呼ばせない。
    SpreadsheetApp: { openById: () => ({ getId: () => "SS_TEST_0001" }) },
    MimeType: { PLAIN_TEXT: "text/plain" },
    PropertiesService: { getScriptProperties: () => propsService, getUserProperties: () => propsService },

    // mapping store の依存（constants / properties / 共通 versioned mapping）。
    FORMS_PROPERTY_KEY: "nfb.forms.mapping",
    FORMS_PROPERTY_VERSION: 1,
    Nfb_getActiveProperties_: () => propsService,
    Nfb_getPropertyStoreMode_: () => "script",
    Nfb_parseVersionedMapping_: (json, expectedVersion) => {
      if (!json) return {};
      try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        if (parsed.version !== expectedVersion) return {};
        if (!parsed.mapping || typeof parsed.mapping !== "object") return {};
        return parsed.mapping;
      } catch (_e) { return {}; }
    },
    Nfb_serializeVersionedMapping_: (props, key, version, mapping, normalizeFn) => {
      const normalized = {};
      for (const id in mapping) {
        if (!Object.prototype.hasOwnProperty.call(mapping, id)) continue;
        normalized[id] = normalizeFn(mapping[id] || {});
      }
      props.setProperty(key, JSON.stringify({ version, mapping: normalized }));
      return normalized;
    },

    // 日時（sheetsDatetime.gs を読まないので shim）。値は使われ方が緩いので決め打ちで良い。
    Sheets_dateToSerial_: () => 46000,
    Sheets_formatJstString_: (serial) => "2026-01-01_00:00:00.000#" + String(serial),
    Sheets_toUnixMs_: () => null,

    // 物理フォルダミラー（formsDriveFolders.gs を読まない）。リネーム検証には不要なので no-op。
    FormsDrive_moveFormFileToPath_: () => true,
    FormsDrive_ensureFolderForPath_: () => null, // null → DriveApp.createFile（ルート）にフォールバック
    FormsDrive_baseFolderOrNull_: () => null,
    FormsDrive_lookupFolderForPath_: () => null,

    // 標準フォルダ（standardFolders*.gs を読まない）。
    StdFolders_autoFileFolderIdOrNull_: () => null,
    StdFolders_findFileByNameInFolder_: () => null,
    StdFolders_isJsonFile_: (f) => /\.json$/i.test(f.getName()),

    // その他の周辺 shim。
    Forms_normalizeFolderPath_: normalizePath,
    nfbStripSchemaIDs_: (schema) => (Array.isArray(schema) ? schema : []),
    NFB_UI_TEMP_KEYS: [],
    AddFormUrl_: () => {},
    nfbErrorToString_: (err) => (err && err.message ? err.message : String(err)),
    // Forms_saveForm_ / Forms_deleteForms_ が nfbSafeCall_（外）→ WithScriptLock_（内）でラップされたため両方を shim。
    nfbSafeCall_: (fn) => {
      try { return fn(); } catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
    },
    WithScriptLock_: (label, fn) => fn(),
    // constants.gs を読まないので shim（重複除去した文字列 id 配列）。
    Nfb_normalizeIdList_: (ids) => {
      const source = Array.isArray(ids) ? ids : [ids];
      const seen = new Set();
      const out = [];
      source.forEach((raw) => {
        if (!raw) return;
        const id = String(raw);
        if (seen.has(id)) return;
        seen.add(id);
        out.push(id);
      });
      return out;
    },
  };

  // ロジック本体（テスト対象 + 直接依存）を実ファイルからロードする。
  loadGasFiles(context, [
    "formsParsing.gs",       // Forms_parseGoogleDriveUrl_ / Forms_parseSpreadsheetTarget_
    "formsTitleHelpers.js",  // Forms_makeUniqueFormTitle_ / Forms_normalizeFormTitle_
    "formsMappingStore.gs",  // Forms_getMapping_ / Forms_saveMapping_ / Forms_stripSchemaIds_
    "sharedEntityCrud.gs",   // SharedCrud_resolveEntityFileOrNull_（Forms_resolveFormFileOrNull_ が委譲）
    "formsCrud.gs",          // Nfb_resolveFileIdFromEntry_ / Forms_resolveFormFileOrNull_ ほか
    "formsStorage.gs",       // Forms_saveForm_（テスト対象）
  ]);

  context.__test = { fileStore, folderStore, propsStore };
  return context;
}

const MAP_KEY = "nfb.forms.mapping";
const readMapping = (ctx) => JSON.parse(ctx.__test.propsStore.get(MAP_KEY)).mapping;
const liveJsonFiles = (ctx) =>
  Array.from(ctx.__test.fileStore.values()).filter((f) => !f.trashed && /\.json$/i.test(f.name));

function baseForm(overrides) {
  return Object.assign({
    schema: [],
    folder: "",
    description: "",
    settings: { formTitle: "見積書", spreadsheetId: SS_URL },
  }, overrides || {});
}

test("Forms_saveForm_ は新規保存で fileId を採番し、ファイル名 ＝ タイトル.json で作る", () => {
  const ctx = loadFormsSaveContext();
  const res = ctx.Forms_saveForm_(baseForm({ id: "" }), null, "auto");
  assert.equal(res.ok, true);
  assert.equal(res.saveMode, "copy_to_root");
  const fileId = res.fileId;
  assert.equal(ctx.__test.fileStore.get(fileId).name, "見積書.json");
  // mapping は fileId キー 1 件。
  const mapping = readMapping(ctx);
  assert.ok(mapping[fileId]);
  assert.equal(mapping[fileId].title, "見積書");
  assert.equal(liveJsonFiles(ctx).length, 1);
});

test("Forms_saveForm_ は同じ id の再保存（リネーム）で同一ファイルを上書きする（二重化しない）", () => {
  const ctx = loadFormsSaveContext();
  const first = ctx.Forms_saveForm_(baseForm({ id: "" }), null, "auto");
  const fileId = first.fileId;
  assert.equal(ctx.__test.fileStore.get(fileId).name, "見積書.json");

  const second = ctx.Forms_saveForm_(
    baseForm({ id: fileId, settings: { formTitle: "請求書", spreadsheetId: SS_URL } }),
    null, "auto",
  );
  assert.equal(second.saveMode, "overwrite_existing");
  assert.equal(second.fileId, fileId, "同一 fileId を再利用する");
  assert.equal(ctx.__test.fileStore.get(fileId).name, "請求書.json", "Drive ファイル名も追従して上書き");
  assert.equal(liveJsonFiles(ctx).length, 1, "ファイルは増えない");
});

test("Forms_saveForm_ は旧 f_ ULID キー（entry.fileId 生存）のリネームで二重化せず fileId キーへ移行する", () => {
  const ctx = loadFormsSaveContext();
  const first = ctx.Forms_saveForm_(baseForm({ id: "" }), null, "auto");
  const fileId = first.fileId;

  // 移行前を再現: 同じ entry を旧 ULID キーへ張り替える（key !== fileId, entry.fileId は生存）。
  const doc = JSON.parse(ctx.__test.propsStore.get(MAP_KEY));
  doc.mapping["f_legacy"] = doc.mapping[fileId];
  delete doc.mapping[fileId];
  ctx.__test.propsStore.set(MAP_KEY, JSON.stringify(doc));

  const renamed = ctx.Forms_saveForm_(
    baseForm({ id: "f_legacy", settings: { formTitle: "見積書new", spreadsheetId: SS_URL } }),
    null, "auto",
  );
  assert.equal(renamed.ok, true);
  assert.equal(renamed.saveMode, "overwrite_existing", "実体を引き当てて上書きする");
  assert.equal(renamed.fileId, fileId, "新 fileId を採番せず生存 fileId を採用");
  assert.equal(ctx.__test.fileStore.get(fileId).name, "見積書new.json");
  assert.equal(liveJsonFiles(ctx).length, 1, "実体は増えない（重複しない）");

  const mapping = readMapping(ctx);
  assert.ok(mapping[fileId], "fileId キーが残る");
  assert.ok(!mapping["f_legacy"], "旧 ULID キーは消える");
  assert.equal(Object.keys(mapping).length, 1);
});

test("Forms_saveForm_ は mapping から消えた stale id でも form.driveFileUrl で実体を引き当てて上書きする", () => {
  const ctx = loadFormsSaveContext();
  const first = ctx.Forms_saveForm_(baseForm({ id: "" }), null, "auto");
  const fileId = first.fileId;
  const fileUrl = ctx.__test.fileStore.get(fileId).id; // wrapper.getUrl と整合する id

  // フロントの IndexedDB キャッシュに残った旧 id を再現: mapping から該当キーを完全に消す。
  // （= dedup/再キーで mapping にエントリ自体が無い。entry での名前/fileId 解決は不可能。）
  const doc = JSON.parse(ctx.__test.propsStore.get(MAP_KEY));
  delete doc.mapping[fileId];
  ctx.__test.propsStore.set(MAP_KEY, JSON.stringify(doc));

  // 保存ペイロードは stale id + 実体 URL（driveFileUrl）を持つ。これが唯一の復旧アンカー。
  const renamed = ctx.Forms_saveForm_(
    baseForm({
      id: "f_stale_not_in_mapping",
      driveFileUrl: `https://drive.google.com/file/d/${fileId}/view`,
      settings: { formTitle: "見積書rev", spreadsheetId: SS_URL },
    }),
    null, "auto",
  );
  assert.equal(renamed.ok, true);
  assert.equal(renamed.saveMode, "overwrite_existing", "新規作成に倒れず実体を上書きする");
  assert.equal(renamed.fileId, fileId, "driveFileUrl が指す生存ファイルを採用");
  assert.equal(ctx.__test.fileStore.get(fileId).name, "見積書rev.json", "実体が setName でリネーム上書き");
  assert.equal(liveJsonFiles(ctx).length, 1, "新規ファイルを作らない（二重化しない）");

  const mapping = readMapping(ctx);
  assert.ok(mapping[fileId], "fileId キーで再登録される");
  assert.equal(Object.keys(mapping).length, 1, "stale キーは増えも残りもしない");
  void fileUrl;
});

// ---- 同名許容: 論理フォルダが違えば同名フォームを許容（衝突採番はフォルダ内のみ） ----

test("Forms_saveForm_ は論理フォルダが違えば同名フォームを許容する（` (1)` を付けない）", () => {
  const ctx = loadFormsSaveContext();
  // フォルダ A に「見積書」
  const a = ctx.Forms_saveForm_(baseForm({ id: "", folder: "A", settings: { formTitle: "見積書", spreadsheetId: SS_URL } }), null, "auto");
  assert.equal(a.ok, true);
  assert.equal(ctx.__test.fileStore.get(a.fileId).name, "見積書.json");
  // フォルダ B にも「見積書」→ フォルダが違うので採番されない
  const b = ctx.Forms_saveForm_(baseForm({ id: "", folder: "B", settings: { formTitle: "見積書", spreadsheetId: SS_URL } }), null, "auto");
  assert.equal(b.ok, true);
  assert.equal(ctx.__test.fileStore.get(b.fileId).name, "見積書.json", "別フォルダなので (1) は付かない");
  assert.equal(readMapping(ctx)[a.fileId].title, "見積書");
  assert.equal(readMapping(ctx)[b.fileId].title, "見積書");
});

test("Forms_saveForm_ は同一フォルダ内の同名は従来どおり ` (1)` を付ける", () => {
  const ctx = loadFormsSaveContext();
  const a = ctx.Forms_saveForm_(baseForm({ id: "", folder: "A", settings: { formTitle: "見積書", spreadsheetId: SS_URL } }), null, "auto");
  const b = ctx.Forms_saveForm_(baseForm({ id: "", folder: "A", settings: { formTitle: "見積書", spreadsheetId: SS_URL } }), null, "auto");
  assert.equal(ctx.__test.fileStore.get(a.fileId).name, "見積書.json");
  assert.equal(ctx.__test.fileStore.get(b.fileId).name, "見積書 (1).json", "同一フォルダ内は採番される");
});

// ---- id ＝ fileId 強制: 保存 .json は id / formTitle を持たず、戻り値の id は fileId ----

test("Forms_saveForm_ は保存 .json に id / settings.formTitle を書かず、戻り form.id ＝ fileId", () => {
  const ctx = loadFormsSaveContext();
  const res = ctx.Forms_saveForm_(baseForm({ id: "" }), null, "auto");
  assert.equal(res.ok, true);
  const fileId = res.fileId;

  // 戻り値の form.id は fileId（local_/f_ ではない）。
  assert.equal(res.form.id, fileId, "戻り form.id ＝ fileId");

  // 保存された .json 実体には id も settings.formTitle も含まれない（読込時に fileId / ファイル名から復元）。
  const saved = JSON.parse(ctx.__test.fileStore.get(fileId).content);
  assert.ok(!("id" in saved), "保存 .json に id を持たない");
  assert.ok(!(saved.settings && "formTitle" in saved.settings), "保存 .json に settings.formTitle を持たない");
});

// ---- 削除 ＝ リンク解除（アンマウント）: mapping から外すが Drive 実体は残す ----

test("Forms_deleteForms_ はマッピングを除去するが Drive ファイル本体は残す（リンク解除のみ）", () => {
  const ctx = loadFormsSaveContext();
  const saved = ctx.Forms_saveForm_(baseForm({ id: "" }), null, "auto");
  const fileId = saved.fileId;
  assert.ok(readMapping(ctx)[fileId], "保存直後は mapping にある");

  const del = ctx.Forms_deleteForms_([fileId]);
  assert.equal(del.ok, true);
  assert.equal(del.deleted, 1);

  // mapping からは外れる（リンク解除）。
  assert.ok(!readMapping(ctx)[fileId], "mapping から除去される");
  // Drive ファイル本体は削除されず残る（trashed=false）。
  assert.equal(ctx.__test.fileStore.get(fileId).trashed, false, "Drive 実体は trash されない");
  assert.equal(liveJsonFiles(ctx).length, 1, "実体ファイルは残る");
});
