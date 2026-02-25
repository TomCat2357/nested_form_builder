// patch.js
const fs = require('fs');
const path = require('path');

const applyPatch = (filePath, replacer) => {
  const fullPath = path.resolve(__dirname, filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }
  const original = fs.readFileSync(fullPath, 'utf8');
  const modified = replacer(original);
  if (original === modified) {
    console.warn(`⚠️ No changes made to: ${filePath}`);
  } else {
    fs.writeFileSync(fullPath, modified, 'utf8');
    console.log(`✅ Patched: ${filePath}`);
  }
};

// 1. 定数の変更 (RECORD_CACHE_MAX_AGE_MS を 60分に)
applyPatch('builder/src/core/constants.js', (content) => {
  return content.replace(
    /export const RECORD_CACHE_MAX_AGE_MS = [^;]+;/,
    'export const RECORD_CACHE_MAX_AGE_MS = 60 * 60 * 1000;'
  );
});

// 2. recordsCache.js に差分適用(applyDeltaToCache)と仮No取得(getMaxRecordNo)を追加
applyPatch('builder/src/app/state/recordsCache.js', (content) => {
  let newContent = content;
  // DRY化: buildMetadata を利用するようにしているので既存のまま。
  // 末尾に新しい関数を追加
  if (!newContent.includes('applyDeltaToCache')) {
    newContent += `
/**
 * キャッシュ内の最大 No. を取得（仮No採番用）
 */
export async function getMaxRecordNo(formId) {
  if (!formId) return 0;
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.records, 'readonly');
  const store = tx.objectStore(STORE_NAMES.records);
  const rawEntries = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId)));
  db.close();
  
  let maxNo = 0;
  for (const entry of rawEntries || []) {
    const no = parseInt(entry['No.'], 10);
    if (!Number.isNaN(no) && no > maxNo) maxNo = no;
  }
  return maxNo;
}

/**
 * 差分データをキャッシュに適用する
 */
export async function applyDeltaToCache(formId, updatedRecords, allIds, headerMatrix = null, schemaHash = null) {
  if (!formId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);
  
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const lastSyncedAt = Date.now();
  const existingRecords = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId))) || [];
  
  const allIdSet = new Set(allIds || []);
  const entryIndexMap = { ...(existingMeta?.entryIndexMap || {}) };
  
  // 1. 削除されたレコードを検知して消去
  for (const record of existingRecords) {
    if (!allIdSet.has(record.entryId)) {
      store.delete(record.compoundId);
      delete entryIndexMap[record.entryId];
    }
  }
  
  // 2. 追加・更新されたレコードをUpsert
  for (const record of updatedRecords || []) {
    const nextRowIndex = entryIndexMap[record.id]; 
    store.put(buildCacheRecord(formId, record, lastSyncedAt, nextRowIndex));
  }
  
  // メタデータの更新
  metaStore.put(buildMetadata(formId, existingMeta, {
    lastSyncedAt,
    headerMatrix: headerMatrix !== null ? headerMatrix : undefined,
    schemaHash: schemaHash !== null ? schemaHash : undefined,
    entryIndexMap
  }));
  
  await waitForTransaction(tx);
  db.close();
}
`;
  }
  return newContent;
});

// 3. dataStore.js の改修 (差分同期対応、仮No採番、1分ルールの厳格化と行ズレ・削除のフォールバック)
applyPatch('builder/src/app/state/dataStore.js', (content) => {
  let newContent = content;

  // upsertEntry の改修 (仮No採番)
  newContent = newContent.replace(
    /async upsertEntry\(formId, payload\) \{([\s\S]*?)const record = \{/m,
    `async upsertEntry(formId, payload) {
    const now = nowSerial();
    const createdAtSerial = Number.isFinite(payload.createdAt)
      ? payload.createdAt
      : (Number.isFinite(payload.createdAtUnixMs) ? payload.createdAtUnixMs : toUnixMs(payload.createdAt));
    const resolvedCreatedAt = Number.isFinite(createdAtSerial) ? createdAtSerial : now;

    let no = payload['No.'];
    if (no === undefined || no === null || no === "") {
      const maxNo = await import("./recordsCache.js").then(m => m.getMaxRecordNo(formId));
      no = maxNo + 1;
    }

    const record = {
      'No.': no,`
  );

  // listEntries の改修 (差分対応)
  newContent = newContent.replace(
    /async listEntries\(formId\) \{([\s\S]*?)const gasResult = await listEntriesFromGas\(\{ \.\.\.sheetConfig, formId \}\);([\s\S]*?)return \{ entries, headerMatrix[^}]+\};\n  \},/m,
    `async listEntries(formId, { lastSyncedAt = null, forceFullSync = false } = {}) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);
    if (!sheetConfig) throw new Error("Spreadsheet not configured for this form");
    
    const startedAt = Date.now();
    perfLogger.logVerbose("records", "listEntries start", { formId, forceFullSync, startedAt });
    
    const payload = { ...sheetConfig, formId, forceFullSync };
    if (!forceFullSync && lastSyncedAt) {
      payload.lastSyncedAt = lastSyncedAt;
    }

    const gasResult = await listEntriesFromGas(payload);
    const lastSyncedAtNext = Date.now();
    
    if (gasResult.isDelta) {
      const updatedEntries = (gasResult.records || []).map(r => mapSheetRecordToEntry(r, formId));
      const { applyDeltaToCache, getRecordsFromCache } = await import("./recordsCache.js");
      await applyDeltaToCache(formId, updatedEntries, gasResult.allIds, gasResult.headerMatrix || null, form.schemaHash);
      
      const fullCache = await getRecordsFromCache(formId);
      const durationMs = Date.now() - startedAt;
      perfLogger.logVerbose("records", "listEntries delta done", { formId, durationMs });
      return { entries: fullCache.entries, headerMatrix: fullCache.headerMatrix, entryIndexMap: fullCache.entryIndexMap, lastSyncedAt: lastSyncedAtNext };
    }

    const entries = (gasResult.records || []).map(r => mapSheetRecordToEntry(r, formId));
    entries.sort((a, b) => { if (a.id < b.id) return -1; if (a.id > b.id) return 1; return 0; });
    const entryIndexMap = {};
    entries.forEach((item, idx) => { entryIndexMap[item.id] = idx; });

    await saveRecordsToCache(formId, entries, gasResult.headerMatrix || [], { schemaHash: form.schemaHash });
    await updateRecordsMeta(formId, { entryIndexMap, lastReloadedAt: lastSyncedAtNext });
    
    const durationMs = Date.now() - startedAt;
    perfLogger.logVerbose("records", "listEntries full done", { formId, durationMs });
    return { entries, headerMatrix: gasResult.headerMatrix || [], entryIndexMap, lastSyncedAt: lastSyncedAtNext };
  },`
  );

  // getEntry の改修 (1分ルールと差分フォールバック)
  newContent = newContent.replace(
    /if \(!shouldSync && cachedEntry\) \{([\s\S]*?)const tBeforeGas = performance.now\(\);/m,
    `// 1分(60,000ms)以内であれば強制同期(forceSync: true)でもキャッシュを優先して通信を避ける
    const isVeryFresh = cacheAge < 60000;
    
    if (cachedEntry && (isVeryFresh || (!shouldSync && !forceSync))) {
      if (shouldBackground) {
        // ...既存のバックグラウンド処理...
        getEntryFromGas({ ...sheetConfig, entryId, rowIndexHint: effectiveRowIndex })
          .then((result) => {
            const mapped = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
            if (mapped) upsertRecordInCache(formId, mapped, { rowIndex: result.rowIndex ?? effectiveRowIndex });
          }).catch(() => {});
      }
      return cachedEntry;
    }

    const tBeforeGas = performance.now();`
  );

  newContent = newContent.replace(
    /const result = await getEntryFromGas\(\{([\s\S]*?)const tBeforeMap/m,
    `const result = await getEntryFromGas({$1
    // GAS側で「行がずれている（違うIDが返ってきた）」または「見つからなかった（削除された）」場合、
    // 単一取得を諦めて差分更新リスト取得にフォールバックする
    if (!result.ok || !result.record || result.record.id !== entryId) {
      console.log("[dataStore.getEntry] row mismatch or deleted. falling back to delta listEntries.");
      const listResult = await this.listEntries(formId, { lastSyncedAt, forceFullSync: false });
      return listResult.entries.find(e => e.id === entryId) || null;
    }

    const tBeforeMap`
  );

  return newContent;
});

// 4. useEntriesWithCache.js の改修 (差分リクエストと強制更新対応)
applyPatch('builder/src/features/search/useEntriesWithCache.js', (content) => {
  return content.replace(
    /const fetchAndCacheData = useCallback\(async \(\{\s*background\s*=\s*false\s*\}\s*=\s*\{\}\) => \{([\s\S]*?)const result = await dataStore\.listEntries\(formId\);/m,
    `const fetchAndCacheData = useCallback(async ({ background = false, forceFullSync = false } = {}) => {
    if (!formId) return;
    if (!background) setLoading(true);
    else setBackgroundLoading(true);
    const startedAt = Date.now();

    try {
      const result = await dataStore.listEntries(formId, { 
        lastSyncedAt: forceFullSync ? null : lastSyncedAt, 
        forceFullSync 
      });`
  ).replace(
    /onClick=\{onRefresh\}/g,
    `onClick={() => fetchAndCacheData({ forceFullSync: true })}` // SearchSidebarへの渡し方を意識
  );
});

// SearchSidebar の onRefresh の呼び出し元の SearchPage.jsx を修正
applyPatch('builder/src/pages/SearchPage.jsx', (content) => {
  return content.replace(
    /onRefresh=\{fetchAndCacheData\}/g,
    `onRefresh={() => fetchAndCacheData({ forceFullSync: true })}`
  );
});


// 5. FormPage.jsx の改修 (仮No・本Noの2段階更新)
applyPatch('builder/src/pages/FormPage.jsx', (content) => {
  let newContent = content.replace(
    /const saved = await dataStore\.upsertEntry\(form\.id, \{[\s\S]*?\}\);/m,
    `const saved = await dataStore.upsertEntry(form.id, {
      id: payload.id,
      data: payload.responses,
      order: payload.order,
      createdBy,
      modifiedBy,
      "No.": entry?.["No."] // 既存のNoを引き継ぐ（新規の場合は upsertEntry 内部で最大値+1が振られる）
    });`
  );

  newContent = newContent.replace(
    /void submitResponses\(\{[\s\S]*?\}\)\.catch\(\(error\) => \{/m,
    `void submitResponses({
          spreadsheetId,
          sheetName,
          payload: { ...payload, id: saved.id },
        }).then(async (gasResult) => {
          // スプレッドシート側で確定した「本No.」を受け取ってキャッシュと画面を更新
          if (gasResult && gasResult.recordNo) {
             const finalRecord = await dataStore.upsertEntry(form.id, {
               ...saved,
               "No.": gasResult.recordNo
             });
             // 現在表示中のレコードと同じなら画面のNo.も更新
             setEntry(prev => prev?.id === finalRecord.id ? finalRecord : prev);
          }
        }).catch((error) => {`
  );
  return newContent;
});

// 6. GAS: model.gs
applyPatch('gas/model.gs', (content) => {
  return content.replace(
    /rowIndexHint: typeof body\.rowIndexHint/,
    `lastSyncedAt: body.lastSyncedAt || params.lastSyncedAt || null,
    forceFullSync: body.forceFullSync === true || params.forceFullSync === 'true',
    rowIndexHint: typeof body.rowIndexHint`
  );
});

// 7. GAS: Code.gs
applyPatch('gas/Code.gs', (content) => {
  return content.replace(
    /rowNumber: result\.row,\s+id: result\.id,/,
    `rowNumber: result.row,\n    id: result.id,\n    recordNo: result.recordNo,`
  );
});

// 8. GAS: sheetsRowOps.gs (本Noの返却)
applyPatch('gas/sheetsRowOps.gs', (content) => {
  let newContent = content.replace(
    /return \{ rowIndex: rowIndex, id: nextId \};/,
    `return { rowIndex: rowIndex, id: nextId, recordNo: maxNo + 1 };`
  );
  newContent = newContent.replace(
    /return \{ row: rowIndex, id: ctx\.id \};/,
    `return { row: rowIndex, id: ctx.id, recordNo: recordNo };`
  );
  newContent = newContent.replace(
    /if \(rowIndex === -1\) \{([\s\S]*?)\} else \{([\s\S]*?)var rowIndex = Sheets_findRowById_\(sheet, ctx\.id\);/m,
    `var rowIndex = Sheets_findRowById_(sheet, ctx.id);
  var recordNo = null;

  if (rowIndex === -1) {
    var newRow = Sheets_createNewRow_(sheet, ctx.id);
    rowIndex = newRow.rowIndex;
    ctx.id = newRow.id;
    recordNo = newRow.recordNo;
  } else {
    Sheets_updateExistingRow_(sheet, rowIndex);
    Sheets_clearDataRow_(sheet, rowIndex, keyToColumn, reservedHeaderKeys);
    recordNo = sheet.getRange(rowIndex, 2).getValue();
  }`
  );
  // 重複定義を避けるための微調整
  newContent = newContent.replace(
    /var rowIndex = Sheets_findRowById_\(sheet, ctx\.id\);\s*var recordNo = null;\s*var rowIndex = Sheets_findRowById_\(sheet, ctx\.id\);/m,
    `var rowIndex = Sheets_findRowById_(sheet, ctx.id);
  var recordNo = null;`
  );
  return newContent;
});

// 9. GAS: sheetsRecords.gs (ListRecords_ の差分対応)
applyPatch('gas/sheetsRecords.gs', (content) => {
  return content.replace(
    /function ListRecords_\(ctx\) \{([\s\S]*?)return \{ ok: true, records, count: records\.length, headerMatrix: Sheets_readHeaderMatrix_\(sheet\) \};\n\}/m,
    `function ListRecords_(ctx) {
  var sheet;
  try {
    sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  } catch (err) {
    return { ok: false, error: Sheets_translateOpenError_(err, ctx.spreadsheetId) };
  }
  var temporalTypeMap = null;
  var formId = ctx && ctx.raw && ctx.raw.formId;
  if (formId) {
    try {
      var form = Forms_getForm_(formId);
      if (form && form.schema) temporalTypeMap = Sheets_collectTemporalPathMap_(form.schema);
    } catch (err) {
      Logger.log("[ListRecords_] Failed to load form schema: " + err);
    }
  }
  
  var allRecords = Sheets_getAllRecords_(sheet, temporalTypeMap);
  var headerMatrix = Sheets_readHeaderMatrix_(sheet);

  if (ctx.forceFullSync || !ctx.lastSyncedAt) {
    return { ok: true, records: allRecords, count: allRecords.length, headerMatrix: headerMatrix, isDelta: false };
  }

  var updatedRecords = [];
  var allIds = [];

  for (var i = 0; i < allRecords.length; i++) {
    var rec = allRecords[i];
    allIds.push(rec.id);
    if (rec.modifiedAtUnixMs > ctx.lastSyncedAt) {
      updatedRecords.push(rec);
    }
  }

  return { ok: true, records: updatedRecords, allIds: allIds, count: updatedRecords.length, headerMatrix: headerMatrix, isDelta: true };
}`
  );
});