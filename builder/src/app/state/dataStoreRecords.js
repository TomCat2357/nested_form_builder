/**
 * dataStore のレコード同期オペレーション群（フォーム CRUD から分離）。
 *
 * createRecordOps({ getForm }) が { upsertEntry, listEntries, getEntry, deleteEntry,
 * undeleteEntry } を返し、dataStore.js が spread でそのまま公開する（公開サーフェス不変）。
 * フォーム本体の取得だけは dataStore 側のキャッシュ／フォールバックを共有したいので
 * getForm を注入する。
 */
import {
  getCachedEntryWithIndex,
  saveRecordsToCache,
  upsertRecordInCache,
  updateRecordsMeta,
  deleteRecordFromCache,
  getMaxRecordNo,
  getMaxRecordNoForPid,
  getRecordsFromCache,
  applySyncResultToCache,
} from "./recordsMemoryStore.js";
import { buildUploadRecordsForSync } from "./syncUploadPlan.js";
import { evaluateCacheForRecords } from "./cachePolicy.js";
import {
  getEntry as getEntryFromGas,
  syncRecordsProxy,
  resolveFormPid,
} from "../../services/gasClient.js";
import { perfLogger } from "../../utils/perfLogger.js";
import {
  getSheetConfig,
  getDeletedRetentionDays,
  getRecordNoStart,
  getRecordNoPerPid,
  resolveNextRecordNo,
  isDeletedEntryExpired,
  pruneExpiredDeletedEntries,
  mapSheetRecordToEntry,
  normalizeListEntriesOptions,
  buildGetEntryFallbackListEntriesOptions,
  buildListEntriesResult,
  buildUpsertEntryRecord,
} from "./dataStoreHelpers.js";

export const createRecordOps = ({ getForm }) => {
  const recordOps = {
    async upsertEntry(formId, payload) {
      const safePayload = payload && typeof payload === "object" ? payload : {};
      const now = Date.now();
      const cached = safePayload.id ? await getCachedEntryWithIndex(formId, safePayload.id) : { entry: null, rowIndex: null };
      const existingEntry = cached.entry;

      // 子フォーム文脈（オーバーレイ登録 or URL 固定）で開いているときの pid を解決する。
      // pid があれば新規/既存を問わずローカル entry にも刻む（サーバも ctx から同じ pid を刻むので値は一致）。
      // これにより、同じ pid での連続作成でも直前の未同期レコードを親ごと採番の集計に取りこぼさない。
      const pid = resolveFormPid(formId);
      let workingPayload = safePayload;
      if (pid && !workingPayload.pid) workingPayload = { ...workingPayload, pid };

      let nextRecordNo = null;
      const payloadRecordNo = safePayload["No."];
      const existingRecordNo = existingEntry?.["No."];
      const needsNewRecordNo = (
        payloadRecordNo === undefined
        || payloadRecordNo === null
        || payloadRecordNo === ""
      ) && (
        existingRecordNo === undefined
        || existingRecordNo === null
        || existingRecordNo === ""
      );
      if (needsNewRecordNo) {
        // フォームはほぼ常にキャッシュ命中で取れる。万一取得できなければ既定（親ごと採番 ON・1 始まり）へフォールバック。
        const form = await getForm(formId).catch(() => null);
        // 「子フォームの No. を親ごとに 1 から振る」設定が ON かつ pid があれば同 pid 内の最大＋1、
        // それ以外（設定 OFF・pid なし＝子フォームでない）は従来どおり全体の最大＋1。
        const maxNo = (getRecordNoPerPid(form) && pid)
          ? await getMaxRecordNoForPid(formId, pid)
          : await getMaxRecordNo(formId);
        // フォーム修正画面で指定した No. の開始番号を下限に採番する（親ごと採番時も各 pid の下限として有効。空欄なら 1 始まり）。
        nextRecordNo = resolveNextRecordNo(maxNo, getRecordNoStart(form));
      }

      const record = buildUpsertEntryRecord({
        formId,
        payload: workingPayload,
        existingEntry,
        now,
        nextRecordNo,
      });
      await upsertRecordInCache(formId, record, {
        headerMatrix: workingPayload.headerMatrix,
        rowIndex: workingPayload.rowIndex ?? cached.rowIndex,
      });
      return record;
    },
    /**
     * @param {string} formId
     * @param {ListEntriesOptions} [options]
     */
    async listEntries(formId, options = {}) {
      const { forceFullSync } = normalizeListEntriesOptions(options);
      // quiet は同期オプションではなくログ抑制フラグ（先行プリフェッチ等が失敗時の console.error を
      // 抑えるため）。normalizeListEntriesOptions の正式キーには含めず、ここで直接読む。
      const quiet = options && options.quiet === true;
      const form = await getForm(formId);
      const sheetConfig = getSheetConfig(form);
      const deletedRetentionDays = getDeletedRetentionDays(form);
      if (!sheetConfig) throw new Error("Spreadsheet not configured for this form");

      const cacheMeta = await getRecordsFromCache(formId);
      const prunedCachedEntries = await pruneExpiredDeletedEntries(formId, cacheMeta.entries, deletedRetentionDays);
      const baseServerReadAt = cacheMeta.lastServerReadAt || 0;
      const uploadRecords = buildUploadRecordsForSync({
        entries: prunedCachedEntries,
        baseServerReadAt,
        forceFullSync,
      });

      const payload = {
        ...sheetConfig,
        formId,
        formSchema: form.schema,
        lastServerReadAt: baseServerReadAt,
        uploadRecords,
        forceFullSync,
        deletedRetentionDays
      };

      // この時点でアップロードのスナップショット（uploadRecords）は確定済み。これ以降に
      // ローカル編集されたレコードは未アップロードなので、古いサーバー応答で上書きしない。
      const syncStartedAt = Date.now();
      const gasResult = await syncRecordsProxy(payload, { quiet });
      const unchanged = gasResult?.unchanged === true;
      const syncedRecords = (gasResult.records || []).map((record) => mapSheetRecordToEntry(record, formId));
      const serverModifiedAt = Number(gasResult.serverModifiedAt ?? gasResult.serverCommitToken);
      const sheetLastUpdatedAt = Number(gasResult.sheetLastUpdatedAt);
      const nextLastServerReadAt = Date.now();
      const postSyncHeaderMatrix = Array.isArray(gasResult.headerMatrix)
        ? gasResult.headerMatrix
        : (cacheMeta.headerMatrix || []);
      const normalizedSheetLastUpdatedAt = Number.isFinite(sheetLastUpdatedAt) && sheetLastUpdatedAt > 0
        ? sheetLastUpdatedAt
        : (cacheMeta.lastSpreadsheetReadAt || 0);

      if (unchanged) {
        await updateRecordsMeta(formId, {
          lastReloadedAt: nextLastServerReadAt,
          lastSpreadsheetReadAt: nextLastServerReadAt,
          lastServerReadAt: nextLastServerReadAt,
          serverCommitToken: gasResult.serverCommitToken,
          serverModifiedAt: serverModifiedAt > 0 ? serverModifiedAt : 0,
          schemaHash: form.schemaHash,
          headerMatrix: postSyncHeaderMatrix,
        });

        return buildListEntriesResult({
          entries: prunedCachedEntries,
          headerMatrix: postSyncHeaderMatrix,
          lastSyncedAt: nextLastServerReadAt,
          lastSpreadsheetReadAt: nextLastServerReadAt,
          hasUnsynced: false,
          unsyncedCount: 0,
          isDelta: true,
          unchanged: true,
          fetchedCount: 0,
          sheetLastUpdatedAt: normalizedSheetLastUpdatedAt,
        });
      }

      if (forceFullSync) {
        await saveRecordsToCache(formId, syncedRecords, postSyncHeaderMatrix, {
          sheetLastUpdatedAt: normalizedSheetLastUpdatedAt,
          serverCommitToken: gasResult.serverCommitToken,
          serverModifiedAt: serverModifiedAt > 0 ? serverModifiedAt : 0,
          lastServerReadAt: nextLastServerReadAt,
          schemaHash: form.schemaHash,
        });
      } else {
        await applySyncResultToCache(formId, syncedRecords, postSyncHeaderMatrix, {
          serverCommitToken: gasResult.serverCommitToken,
          serverModifiedAt: serverModifiedAt > 0 ? serverModifiedAt : 0,
          lastServerReadAt: nextLastServerReadAt,
          syncStartedAt,
        });
      }

      // シンク後の状態を取得する。差分マージは applySyncResultToCache が syncStartedAt 保護つきで
      // ストアへ反映済みなので、保護結果を正しく返すためストア（メモリ）から読み戻す。
      let postSyncEntries;
      if (forceFullSync) {
        postSyncEntries = syncedRecords;
      } else {
        postSyncEntries = (await getRecordsFromCache(formId)).entries;
      }

      // 期限切れ tombstone だけをキャッシュから物理除去し、削除済み表示の制御は UI 側に委ねる
      const prunedEntries = await pruneExpiredDeletedEntries(formId, postSyncEntries, deletedRetentionDays);
      const unsyncedCount = prunedEntries.filter((e) => (e.modifiedAtUnixMs || 0) > nextLastServerReadAt).length;
      const hasUnsynced = unsyncedCount > 0;

      return buildListEntriesResult({
        entries: prunedEntries,
        headerMatrix: postSyncHeaderMatrix,
        lastSyncedAt: Date.now(),
        lastSpreadsheetReadAt: nextLastServerReadAt,
        hasUnsynced,
        unsyncedCount,
        isDelta: gasResult?.isDelta === true,
        unchanged: false,
        fetchedCount: syncedRecords.length,
        sheetLastUpdatedAt: normalizedSheetLastUpdatedAt,
      });
    },
    async getEntry(formId, entryId, { forceSync = false, rowIndexHint = undefined } = {}) {
      const form = await getForm(formId);
      const sheetConfig = getSheetConfig(form);
      if (!sheetConfig) {
        throw new Error("Spreadsheet not configured for this form");
      }

      const startedAt = Date.now();
      const tGetCacheStart = performance.now();
      const {
        entry: cachedEntry,
        rowIndex: cachedRowIndex,
        lastSyncedAt,
      } = await getCachedEntryWithIndex(formId, entryId);
      const deletedRetentionDays = getDeletedRetentionDays(form);
      const cacheEntryExpired = isDeletedEntryExpired(cachedEntry, deletedRetentionDays);
      if (cacheEntryExpired && cachedEntry?.id) {
        await deleteRecordFromCache(formId, cachedEntry.id);
      }
      const usableCachedEntry = cacheEntryExpired ? null : cachedEntry;
      const tGetCacheEnd = performance.now();
      perfLogger.logVerbose("records", "getEntry cache lookup", {
        durationMs: Number((tGetCacheEnd - tGetCacheStart).toFixed(2)),
        formId,
        entryId,
      });

      // rowIndexHintが明示的に渡された場合はそれを優先、なければキャッシュから取得したものを使用
      const effectiveRowIndex = rowIndexHint !== undefined ? rowIndexHint : cachedRowIndex;

      const { age: cacheAge, shouldSync, shouldBackground } = evaluateCacheForRecords({
        lastSyncedAt,
        hasData: !!usableCachedEntry,
        forceSync,
      });

      // 1分(60,000ms)以内であれば強制同期(forceSync: true)でもキャッシュを優先して通信を避ける
      const isVeryFresh = cacheAge < 60000;

      if (usableCachedEntry && (isVeryFresh || (!shouldSync && !forceSync))) {
        if (shouldBackground) {
          const bgStartedAt = Date.now();
          getEntryFromGas({ formId, sheetName: sheetConfig.sheetName, entryId, rowIndexHint: effectiveRowIndex })
            .then((result) => {
              const mappedRecord = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
              const mapped = isDeletedEntryExpired(mappedRecord, deletedRetentionDays) ? null : mappedRecord;
              if (mapped) upsertRecordInCache(formId, mapped, { rowIndex: result.rowIndex ?? effectiveRowIndex, syncStartedAt: bgStartedAt });
            }).catch(() => {});
        }
        return usableCachedEntry;
      }

      const tBeforeGas = performance.now();
      const result = await getEntryFromGas({
        formId,
        sheetName: sheetConfig.sheetName,
        entryId,
        rowIndexHint: effectiveRowIndex,
      });
      const tAfterGas = performance.now();
      perfLogger.logVerbose("records", "getEntry GAS fetch", {
        durationMs: Number((tAfterGas - tBeforeGas).toFixed(2)),
        formId,
        entryId,
      });


      // GAS側で「行がずれている（違うIDが返ってきた）」または「見つからなかった（削除された）」場合、
      // 単一取得を諦めて差分更新リスト取得にフォールバックする
      if (!result.ok || !result.record || result.record.id !== entryId) {
        const listResult = await recordOps.listEntries(formId, buildGetEntryFallbackListEntriesOptions());
        return listResult.entries.find(e => e.id === entryId) || null;
      }

      const tBeforeMap = performance.now();
      const mappedRecord = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
      const mapped = isDeletedEntryExpired(mappedRecord, deletedRetentionDays) ? null : mappedRecord;
      const tAfterMap = performance.now();
      perfLogger.logVerbose("records", "getEntry map record", {
        durationMs: Number((tAfterMap - tBeforeMap).toFixed(2)),
        formId,
        entryId,
      });

      if (mapped) {
        const nextRowIndex = typeof result.rowIndex === "number" ? result.rowIndex : effectiveRowIndex;
        const tBeforeUpsert = performance.now();
        await upsertRecordInCache(formId, mapped, { rowIndex: nextRowIndex });
        const tAfterUpsert = performance.now();
        perfLogger.logVerbose("records", "getEntry cache upsert", {
          durationMs: Number((tAfterUpsert - tBeforeUpsert).toFixed(2)),
          formId,
          entryId,
          rowIndex: nextRowIndex,
        });

        const finishedAt = Date.now();
        const durationMs = finishedAt - startedAt;
        perfLogger.logVerbose("records", "getEntry done", {
          formId,
          entryId,
          fromCache: false,
          durationMs,
          rowIndex: nextRowIndex,
        });
        perfLogger.logRecordGasRead(tAfterGas - tBeforeGas, entryId, "single-sync");
        perfLogger.logRecordCacheUpdate(tAfterUpsert - tBeforeUpsert, entryId);
        return mapped;
      }

      const finishedAt = Date.now();
      perfLogger.logVerbose("records", "getEntry done", {
        formId,
        entryId,
        fromCache: !!usableCachedEntry,
        durationMs: finishedAt - startedAt,
        fallbackCache: true,
      });
      if (usableCachedEntry) {
        perfLogger.logRecordCacheHit(tGetCacheEnd - tGetCacheStart, entryId);
      }
      return usableCachedEntry;
    },
    async deleteEntry(formId, entryId, { deletedBy = "" } = {}) {
      const { entry, rowIndex } = await getCachedEntryWithIndex(formId, entryId);
      if (!entry) return;
      const now = Date.now();
      const deleted = {
        ...entry,
        deletedAt: now,
        deletedAtUnixMs: now,
        deletedBy: deletedBy || entry.deletedBy || "",
        modifiedAtUnixMs: now,
        modifiedAt: now,
        modifiedBy: deletedBy || entry.modifiedBy || "",
      };
      await upsertRecordInCache(formId, deleted, { rowIndex });
    },
    async undeleteEntry(formId, entryId, { modifiedBy = "" } = {}) {
      const { entry, rowIndex } = await getCachedEntryWithIndex(formId, entryId);
      if (!entry) return;
      const now = Date.now();
      const undeleted = {
        ...entry,
        deletedAt: null,
        deletedAtUnixMs: null,
        deletedBy: "",
        modifiedAt: now,
        modifiedAtUnixMs: now,
        modifiedBy: modifiedBy || entry.modifiedBy || "",
      };
      await upsertRecordInCache(formId, undeleted, { rowIndex });
    },
  };
  return recordOps;
};
