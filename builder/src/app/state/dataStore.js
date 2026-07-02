import { ensureArray, toIdList } from "../../utils/arrays.js";
import { stripSchemaIDs, deepClone } from "../../core/schema.js";
import { normalizeFormRecord } from "../../utils/formNormalize.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import { clearFormRecordsCache } from "./recordsMemoryStore.js";
import { invalidateChildForm } from "./childRecordsMemoryStore.js";
import { getFormsFromCache } from "./formsCache.js";
import { registryStore } from "./registryStore.js";
import { createRecordOps } from "./dataStoreRecords.js";
import {
  listForms as listFormsFromGas,
  getForm as getFormFromGas,
  saveForm as saveFormToGas,
  deleteFormFromDrive as deleteFormFromGas,
  deleteFormsFromDrive as deleteFormsFromGas,
  deleteFormsWithFiles as deleteFormsWithFilesInGas,
  setFormReadOnly as setFormReadOnlyInGas,
  clearFormReadOnly as clearFormReadOnlyInGas,
  setFormsReadOnly as setFormsReadOnlyInGas,
  clearFormsReadOnly as clearFormsReadOnlyInGas,
  setFormChildOnly as setFormChildOnlyInGas,
  clearFormChildOnly as clearFormChildOnlyInGas,
  setFormsChildOnly as setFormsChildOnlyInGas,
  clearFormsChildOnly as clearFormsChildOnlyInGas,
  registerImportedForm as registerImportedFormInGas,
  copyForm as copyFormFromGas,
} from "../../services/gasClient.js";
import { genLocalId, isLocalId } from "../../core/ids.js";
import { enqueueOpJob, deleteJobsForLocalId, deleteOpJobsForFolderPrefix } from "./uploadQueue.js";
import { kickUploadWorker, enqueueEntitySave } from "./uploadWorker.js";
import { spreadsheetTargetKey } from "./dataStoreHelpers.js";

// ---------------------------------------------------------------------------
// dataStore-local helpers (moved from dataStoreHelpers.js)
// ---------------------------------------------------------------------------

const pendingOperations = new Set();

const displayInfoCache = new Map();

const resolveSchemaVersionKey = (form) => {
  if (!form || !form.id) return "";
  if (form.schemaHash) return `hash:${form.schemaHash}`;
  return `fallback:${form.updatedAtUnixMs || form.modifiedAtUnixMs || form.updatedAt || form.modifiedAt || "none"}`;
};

const ensureDisplayInfo = (form) => {
  const schema = Array.isArray(form?.schema) ? form.schema : [];
  const cacheKey = resolveSchemaVersionKey(form);
  const cached = displayInfoCache.get(form?.id);
  const displayInfo = cached?.versionKey === cacheKey
    ? cached
    : (() => {
      const displayFieldSettings = collectDisplayFieldSettings(schema);
      const importantFields = displayFieldSettings.map((item) => item.path);
      const next = { versionKey: cacheKey, displayFieldSettings, importantFields };
      if (form?.id) displayInfoCache.set(form.id, next);
      return next;
    })();

  return {
    ...form,
    displayFieldSettings: displayInfo.displayFieldSettings,
    importantFields: displayInfo.importantFields,
  };
};

// レコード同期オペレーション（dataStoreRecords.js に分離）。getForm は dataStore の
// キャッシュ／フォールバック実装を共有するため遅延参照で注入する。
const recordOps = createRecordOps({
  getForm: (formId, options) => dataStore.getForm(formId, options),
});

export const dataStore = {
  ...recordOps,
  async listForms({ includeArchived = false } = {}) {

    const result = await listFormsFromGas({ includeArchived });
    const forms = ensureArray(result.forms);
    const loadFailures = ensureArray(result.loadFailures);
    const folders = ensureArray(result.folders);
    // registry 作業キャッシュ（フロント）をサーバ確定の一覧で充填／更新する（非ブロッキング・fail-safe）。
    // forms のラベルは settings.formTitle なので registry の name へ移す。
    registryStore
      .fillFromList(
        "forms",
        forms.map((form) => ({
          fileId: form.id,
          name: (form.settings && form.settings.formTitle) || "",
          folder: typeof form.folder === "string" ? form.folder : "",
          driveFileUrl: form.driveFileUrl || "",
        })),
        { stampSyncTime: true }
      )
      .catch(() => {});
    return {
      forms: forms.map((form) => ensureDisplayInfo(form)),
      loadFailures,
      folders,
      source: "gas",
    };
  },
  async createFolder(path) {
    // 楽観的＋遅延: folders 登録簿の即時更新は AppDataProvider が担う。GAS 実体作成は op ジョブへ。
    await enqueueOpJob({ entityType: "form", opType: "createFolder", opPayload: { path } });
    kickUploadWorker();
    return { folders: [] };
  },
  async moveItems(payload) {
    // 楽観的＋遅延: React 状態 / キャッシュ / folders の即時更新は AppDataProvider が担う。
    // ここでは GAS 移動を write-behind ジョブとしてキューへ積むだけ。未アップロードの
    // local_ フォームを移動する場合は、その save 完了まで依存（dependsOnLocalIds）で待つ。
    const formIds = Array.isArray(payload?.formIds) ? payload.formIds : [];
    await enqueueOpJob({
      entityType: "form",
      opType: "move",
      opPayload: payload,
      dependsOnLocalIds: formIds.filter(isLocalId),
    });
    kickUploadWorker();
    return { folders: [], movedFormIds: formIds };
  },
  async renameFolder(payload) {
    await enqueueOpJob({ entityType: "form", opType: "renameFolder", opPayload: payload });
    kickUploadWorker();
    return { folders: [], movedFormIds: [] };
  },
  async deleteFolder(path, { containedIds = [] } = {}) {
    // 配下エンティティの保留 save/move ジョブを取り消す（削除済みフォームの再作成・再移動を防ぐ）。
    await Promise.all(containedIds.map((id) => deleteJobsForLocalId(id)));
    await deleteOpJobsForFolderPrefix("form", path);
    // createFolder は GAS 実体を作るため、サーバのフォルダ削除は deleteFolder op で行う。
    await enqueueOpJob({ entityType: "form", opType: "deleteFolder", opPayload: { path } });
    kickUploadWorker();
    return { folders: [], deletedFormCount: containedIds.length };
  },
  async getForm(formId, { forceRefresh = false } = {}) {
    if (!forceRefresh) {
      try {
        const { forms = [] } = await getFormsFromCache();
        const cachedForm = forms.find((form) => form.id === formId);
        if (cachedForm) {
          return ensureDisplayInfo(cachedForm);
        }
      } catch (error) {
        console.warn("[dataStore.getForm] Cache lookup failed, falling back to GAS:", error);
      }
    }
    // forceRefresh 時はサーバ最新を取得。失敗（オフライン等）はキャッシュへフォールバックして
    // 編集画面が開けるようにする。
    try {
      const form = await getFormFromGas(formId);
      if (form) return ensureDisplayInfo(form);
      if (!forceRefresh) return null;
    } catch (error) {
      if (!forceRefresh) throw error;
      console.warn("[dataStore.getForm] forceRefresh GAS fetch failed, falling back to cache:", error);
    }
    try {
      const { forms = [] } = await getFormsFromCache();
      const cachedForm = forms.find((form) => form.id === formId);
      if (cachedForm) return ensureDisplayInfo(cachedForm);
    } catch (error) {
      console.warn("[dataStore.getForm] Cache fallback lookup failed:", error);
    }
    return null;
  },
  async createForm(payload, saveMode = "auto") {
    // オフラインファースト: まず IndexedDB に保存し、Drive へのアップロードはバックグラウンドへ。
    // 新規フォームは一時 ID(local_…) を採番しておき、アップロード完了時に GAS が返す実 fileId へ
    // 付け替える（参照も自動再リンク）。ネット未接続でも作成できる。
    const record = normalizeFormRecord(payload, { fallbackId: payload?.id || genLocalId() });
    const localRecord = { ...record, pendingUpload: true };
    // 保存コアは共通プリミティブへ委譲。フォームの React 状態反映は AppDataProvider が担うため
    // upsertCache / emit は渡さない（Question/Dashboard との差異はここだけ）。
    await enqueueEntitySave({ entityType: "form", record: localRecord });
    return ensureDisplayInfo(localRecord);
  },
  async registerImportedForm(payload) {
    // payload: { form, fileId, fileUrl }
    const result = await registerImportedFormInGas(payload);
    const form = result?.form;
    const fileUrl = result?.fileUrl || payload.fileUrl;
    return form ? ensureDisplayInfo({ ...form, driveFileUrl: fileUrl }) : null;
  },
  async copyForm(formId) {
    // オフラインファースト: キャッシュ上の元フォームを複製し、新規 save ジョブとしてキューへ。
    // GAS の Forms_copyForm_ と同様に spreadsheetId 等の設定はそのまま引き継ぐ（コピー同士で
    // 同じスプレッドシートを共有する既存挙動と一致）。アップロード完了で local_ → 実 fileId へ付け替え。
    let source = null;
    try {
      const { forms = [] } = await getFormsFromCache();
      source = forms.find((form) => form.id === formId) || null;
    } catch (error) {
      console.warn("[dataStore.copyForm] Cache lookup failed, falling back to GAS:", error);
    }
    if (!source) {
      // キャッシュ未ヒット時のみ従来のサーバコピーにフォールバック。
      const result = await copyFormFromGas(formId);
      const savedForm = result?.form || result;
      const fileUrl = result?.fileUrl;
      const formWithUrl = { ...savedForm, driveFileUrl: fileUrl };
      return formWithUrl ? ensureDisplayInfo(formWithUrl) : null;
    }
    const localId = genLocalId();
    const {
      id: _id,
      createdAt: _createdAt,
      createdAtUnixMs: _createdAtUnixMs,
      modifiedAt: _modifiedAt,
      modifiedAtUnixMs: _modifiedAtUnixMs,
      driveFileUrl: _driveFileUrl,
      pendingUpload: _pendingUpload,
      ...rest
    } = deepClone(source);
    const baseTitle = rest?.settings?.formTitle || rest?.name || "無題のフォーム";
    const clone = normalizeFormRecord({
      ...rest,
      name: undefined,
      settings: { ...(rest.settings || {}), formTitle: `${baseTitle}（コピー）` },
      archived: false,
      readOnly: false,
    }, { fallbackId: localId });
    const localRecord = { ...clone, pendingUpload: true };
    await enqueueEntitySave({ entityType: "form", record: localRecord });
    return ensureDisplayInfo(localRecord);
  },
  async updateForm(formId, updates, saveMode = "auto") {
    // First get the current form. If GAS fetch fails, fallback to provided updates.
    let current = null;
    try {
      current = await this.getForm(formId);
    } catch (error) {
      console.warn("[dataStore.updateForm] Failed to fetch current form, fallback to updates:", error);
    }

    if (!current) {
      if (updates?.id || updates?.schema || updates?.settings) {
        current = {
          id: formId,
          createdAt: updates.createdAt,
          archived: updates.archived,
          childOnly: updates.childOnly,
          schemaVersion: updates.schemaVersion,
          driveFileUrl: updates.driveFileUrl,
          ...updates,
        };
      } else {
        throw new Error("Current form not found");
      }
    }

    const next = normalizeFormRecord({
      ...current,
      ...updates,
      id: current.id,
      createdAt: current.createdAt,
      archived: updates.archived ?? current.archived,
      childOnly: updates.childOnly ?? current.childOnly,
      schemaVersion: updates.schemaVersion ?? current.schemaVersion,
      driveFileUrl: current.driveFileUrl, // 既存のURLを保持
    });
    // schema 未更新時は既存 schemaHash を維持。normalizeFormRecord は毎回再計算するが、
    // GAS 側が保存時に Forms_stripSchemaIds_ で field id を落とすため、ロード後の
    // schema から再計算した hash は「初回保存時の hash」と一致せず、テーマ変更だけで
    // /search の records cache が schemaMismatch として消えてしまう。
    if (updates.schema === undefined && current.schemaHash) {
      next.schemaHash = current.schemaHash;
    }
    // driveFileUrl は normalizeFormRecord で落ちるが、GAS 側の stale id 救済（旧 id が mapping に
    // 無くても実体ファイルを driveFileUrl で特定して上書き）に使うため明示的に引き継ぐ。
    // 実体 URL は保存後に GAS が確定値で上書きする。
    next.driveFileUrl = updates.driveFileUrl || current.driveFileUrl;
    // スプレッドシート保存先が別シートへ張り替えられたら、このフォームのレコードキャッシュを破棄する。
    // キャッシュは formId だけをキーにしており旧シートと紐付かないため、残すと旧シート由来の未同期行が
    // 次回 listEntries で新シートへ push され上書き／汚染される。current が取れなかった場合は比較できないので
    // 安全側で何もしない（元から cache が無い可能性も高い）。
    const prevTargetKey = spreadsheetTargetKey(current?.settings);
    const nextTargetKey = spreadsheetTargetKey(next?.settings);
    if (current && prevTargetKey !== nextTargetKey) {
      await clearFormRecordsCache(formId);
      // このフォームが他フォームの formLink 子として使われている場合、子レコードキャッシュ
      // （key=`formId::pid`）も旧シート由来で stale になるため一緒に破棄＋リスナ通知する。
      await invalidateChildForm(formId);
    }
    // オフラインファースト: まず IndexedDB に保存し、Drive への上書きはバックグラウンドへ委ねる。
    // formId が一時 ID（未アップロードのフォーム編集）の場合は enqueueJob 側で既存ジョブと
    // coalesce され、1 回だけアップロードされる。
    const localRecord = { ...next, pendingUpload: true };
    // localRecord.id === formId（normalizeFormRecord が id: current.id を維持）。
    await enqueueEntitySave({ entityType: "form", record: localRecord });
    return ensureDisplayInfo(localRecord);
  },
  // 楽観的＋遅延: アーカイブ状態のフリップは AppDataProvider が即時反映。ここでは GAS 呼び出しを
  // write-behind の op ジョブへ積むだけ（local_ フォームは save 完了まで依存で待つ）。
  async _enqueueArchiveOp(formIds, opType) {
    const ids = toIdList(formIds);
    if (!ids.length) return { forms: [], updated: 0 };
    await enqueueOpJob({
      entityType: "form",
      opType,
      opPayload: { ids },
      dependsOnLocalIds: ids.filter(isLocalId),
    });
    kickUploadWorker();
    return { forms: [], updated: ids.length };
  },
  async archiveForm(formId) {
    await this._enqueueArchiveOp([formId], "archive");
    return null;
  },
  async unarchiveForm(formId) {
    await this._enqueueArchiveOp([formId], "unarchive");
    return null;
  },
  async _batchArchiveAction(formIds, gasFn) {
    const targetIds = toIdList(formIds);
    if (!targetIds.length) return { forms: [], updated: 0 };

    const result = await gasFn(targetIds);
    return {
      forms: (result.forms || []).map((form) => (form ? ensureDisplayInfo(form) : null)).filter(Boolean),
      updated: result.updated || 0,
      errors: result.errors || [],
    };
  },
  async archiveForms(formIds) {
    return this._enqueueArchiveOp(formIds, "archive");
  },
  async unarchiveForms(formIds) {
    return this._enqueueArchiveOp(formIds, "unarchive");
  },
  async setFormReadOnlyState(formId, readOnly) {
    const savedForm = readOnly ? await setFormReadOnlyInGas(formId) : await clearFormReadOnlyInGas(formId);
    return savedForm ? ensureDisplayInfo(savedForm) : null;
  },
  async setFormReadOnly(formId) {
    return this.setFormReadOnlyState(formId, true);
  },
  async clearFormReadOnly(formId) {
    return this.setFormReadOnlyState(formId, false);
  },
  async setFormsReadOnly(formIds) {
    return this._batchArchiveAction(formIds, setFormsReadOnlyInGas);
  },
  async clearFormsReadOnly(formIds) {
    return this._batchArchiveAction(formIds, clearFormsReadOnlyInGas);
  },
  async setFormChildOnlyState(formId, childOnly) {
    const savedForm = childOnly ? await setFormChildOnlyInGas(formId) : await clearFormChildOnlyInGas(formId);
    return savedForm ? ensureDisplayInfo(savedForm) : null;
  },
  async setFormChildOnly(formId) {
    return this.setFormChildOnlyState(formId, true);
  },
  async clearFormChildOnly(formId) {
    return this.setFormChildOnlyState(formId, false);
  },
  async setFormsChildOnly(formIds) {
    return this._batchArchiveAction(formIds, setFormsChildOnlyInGas);
  },
  async clearFormsChildOnly(formIds) {
    return this._batchArchiveAction(formIds, clearFormsChildOnlyInGas);
  },
  async deleteForms(formIds) {
    const targetIds = toIdList(formIds);
    if (!targetIds.length) return;

    // 削除対象に未アップロードジョブが残っていれば取り消す（削除済みフォームの再作成を防ぐ）。
    await Promise.all(targetIds.map((id) => deleteJobsForLocalId(id)));
    kickUploadWorker();

    // 一時 ID（まだ Drive に存在しない）のフォームは GAS 削除を呼ばない。
    const remoteIds = targetIds.filter((id) => !isLocalId(id));
    if (remoteIds.length) await deleteFormsFromGas(remoteIds);
  },
  async deleteForm(formId) {
    await this.deleteForms([formId]);
  },
  // deleteForms と同じだが、プロジェクト内（標準フォルダ配下）のファイルは実体も Drive ゴミ箱へ
  // 移動する。プロジェクト外はリンク解除のみで実体を残す（判定は GAS 側がファイルごとに行う）。
  async deleteFormsWithFiles(formIds) {
    const targetIds = toIdList(formIds);
    if (!targetIds.length) return;

    await Promise.all(targetIds.map((id) => deleteJobsForLocalId(id)));
    kickUploadWorker();

    const remoteIds = targetIds.filter((id) => !isLocalId(id));
    if (remoteIds.length) await deleteFormsWithFilesInGas(remoteIds);
  },
  async importForms(jsonList) {
    const created = [];
    for (const item of jsonList) {
      if (!item) continue;
      // id ＝ Drive fileId へ統一。インポートは常に新規ファイルを作成し、その fileId を id とする。
      const record = normalizeFormRecord({
        ...item,
        id: "",
        createdAt: item.createdAt,
        schemaVersion: item.schemaVersion,
      }, { fallbackId: "" });
      const result = await saveFormToGas(record);
      const savedForm = result?.form || result;
      created.push(ensureDisplayInfo(savedForm));
    }
    return created;
  },
  async exportForms(formIds) {
    // Get forms from GAS
    const { forms: allForms } = await this.listForms({ includeArchived: true });
    const selected = allForms.filter((form) => formIds.includes(form.id));

    return selected.map((form) => {
      const {
        id,
        schemaHash,
        importantFields,
        displayFieldSettings,
        createdAt,
        modifiedAt,
        archived,
        schemaVersion,
        ...rest
      } = form;
      // スキーマからもIDを除去
      const cleaned = {
        ...rest,
        schema: stripSchemaIDs(rest.schema || []),
      };
      return deepClone(cleaned);
    });
  },
  async flushPendingOperations() {
    await Promise.allSettled(Array.from(pendingOperations));
  },
};
