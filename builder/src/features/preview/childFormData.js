/**
 * 「別フォームを開く（formLink）」の子フォームデータを Webhook / 印刷様式へ渡すための
 * 合成オブジェクト構築・子フォーム schema キャッシュ・pid 分配ヘルパ。
 *
 * formLink 項目（includeChildData=ON）について、このレコードに紐づく子フォーム行
 * （pid == 親レコード id）を以下の形に整形して式評価 row / payload に注入する:
 *
 *   { childFormId, childFormName, childFormUrl, count, truncated?, records:[{id,no,items}] }
 *
 * これを CHILD_FORM_NAME / CHILD_FORM_ID / CHILD_FORM_URL / CHILD_FORM_COUNT UDF が
 * `項目名` 経由で読む（FILE_NAMES / FOLDER_URL と同じ流儀。registerNfbUdfs.js 参照）。
 *
 * 子レコードの回答は path-keyed の record.data なので、buildRecordItems が要求する
 * id-keyed responses へ restoreResponsesFromData で変換してから items を組む（要 子 schema）。
 */

import { restoreResponsesFromData } from "../../utils/responses.js";
import { buildRecordItems } from "./printDocument.js";
import { dataStore } from "../../app/state/dataStore.js";
import { traverseSchema } from "../../core/schemaUtils.js";
import { joinFieldPath } from "../../utils/pathCodec.js";
import { hasScriptRun, listRecordsByPids } from "../../services/gasClient.js";
import { buildChildFormUrl } from "../../utils/formShareUrl.js";

/**
 * schema 内の formLink フィールド（childFormId と id がともに非空）を収集する純関数。
 * プレビュー（子レコード件数バッジ・子データ詳細）と検索結果一覧（Webhook 用プリロード）で
 * 共有する。includeChildData を必ず含めて全件返すので、includeChildData=ON だけ必要な
 * 呼び出し側は `.filter((f) => f.includeChildData)` する。正規化は行わない（呼び出し側責務）。
 *
 * @param {Array} schema
 * @returns {Array<{id:string, childFormId:string, includeChildData:boolean, childFormName:string, path:string}>}
 */
export const collectFormLinkFields = (schema) => {
  const out = [];
  traverseSchema(schema, (field, context) => {
    if (field?.type !== "formLink") return;
    const childFormId = typeof field.childFormId === "string" ? field.childFormId.trim() : "";
    const id = typeof field.id === "string" ? field.id.trim() : "";
    if (!childFormId || !id) return;
    out.push({
      id,
      childFormId,
      includeChildData: field.includeChildData === true,
      childFormName: typeof field.childFormPath === "string" ? field.childFormPath : "",
      path: joinFieldPath(context.pathSegments || []),
    });
  });
  return out;
};

// payload / Doc 肥大を防ぐための 1 項目あたり最大子レコード数。超過時は records を
// 切り詰め、truncated:true を立てる（count は元の総数を維持する）。
export const MAX_CHILD_RECORDS_PER_FIELD = 200;

// childFormId → Promise<form> の in-flight / 結果キャッシュ。子 schema 取得の重複呼び出しを防ぐ。
const childFormPromiseCache = new Map();

// 子フォーム定義（schema 含む）をキャッシュ付きで取得する。dataStore.getForm は
// IndexedDB キャッシュ優先で、未ヒット時のみ GAS にフォールバックする。
export const getChildFormCached_ = (childFormId) => {
  const id = String(childFormId || "").trim();
  if (!id) return Promise.resolve(null);
  if (childFormPromiseCache.has(id)) return childFormPromiseCache.get(id);
  const p = Promise.resolve()
    .then(() => dataStore.getForm(id))
    .catch((error) => {
      // 失敗はキャッシュしない（次回再試行できるように）。
      childFormPromiseCache.delete(id);
      throw error;
    });
  childFormPromiseCache.set(id, p);
  return p;
};

// テスト用 — キャッシュをクリアする。
export const _clearChildFormCacheForTest = () => childFormPromiseCache.clear();

// 1 レコード（listRecords が返す { id, "No.", data, dataUnixMs }）を { id, no, items } に整形する。
const toChildRecordItem_ = (childSchema, record) => {
  const data = record && record.data && typeof record.data === "object" ? record.data : {};
  const dataUnixMs = record && record.dataUnixMs && typeof record.dataUnixMs === "object" ? record.dataUnixMs : {};
  const responses = restoreResponsesFromData(childSchema || [], data, dataUnixMs);
  return {
    id: String(record && record.id ? record.id : ""),
    no: record && record["No."] != null ? record["No."] : "",
    items: buildRecordItems(childSchema || [], responses),
  };
};

/**
 * 子フォームの合成オブジェクトを組む。
 *
 * @param {Object} args
 * @param {string} args.childFormId  子フォームの fileId
 * @param {string} args.childFormName 子フォーム名（論理パス等）
 * @param {string} args.childFormUrl  子フォームを開く URL（?form=...&pid=...）
 * @param {Array}  args.childSchema   子フォームの schema（items 構築に必須）
 * @param {Array}  args.records       listRecords が返す子レコード配列
 * @returns {{childFormId,childFormName,childFormUrl,count,truncated?:boolean,records:Array}}
 */
export const buildChildDataObject = ({ childFormId, childFormName, childFormUrl, childSchema, records } = {}) => {
  const list = Array.isArray(records) ? records : [];
  const total = list.length;
  const truncated = total > MAX_CHILD_RECORDS_PER_FIELD;
  const sliced = truncated ? list.slice(0, MAX_CHILD_RECORDS_PER_FIELD) : list;
  const out = {
    childFormId: String(childFormId || ""),
    childFormName: String(childFormName || ""),
    childFormUrl: String(childFormUrl || ""),
    count: total,
    records: sliced.map((r) => toChildRecordItem_(childSchema, r)),
  };
  if (truncated) out.truncated = true;
  return out;
};

/**
 * listRecordsByPids が返す（複数 pid 混在の）レコード配列を pid ごとに分配する。
 * 検索結果一覧で「子フォームごと 1 回 OR 取得 → 行へ配る」用途。
 *
 * @param {Array} records
 * @returns {Map<string, Array>} pid → records[]
 */
export const distributeChildRecordsByPid = (records) => {
  const map = new Map();
  (Array.isArray(records) ? records : []).forEach((r) => {
    const pid = String(r && r.pid != null ? r.pid : "").trim();
    if (!pid) return;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push(r);
  });
  return map;
};

/**
 * Question SQL / 検索の厳密モードで CHILD_FORM_NAME / CHILD_FORM_ID / CHILD_FORM_URL /
 * CHILD_FORM_COUNT UDF を使えるようにするための「軽量」子フォーム注入オブジェクトを構築する。
 *
 * クエリ用途では子レコード本体（records / items）は不要で、4 つの UDF はいずれも
 * { childFormId, childFormName, childFormUrl, count } だけ読む（CHILD_FORM_COUNT は count を優先）。
 * そこで items 整形（buildRecordItems）も子 schema 取得もせず、子フォームごとに 1 回だけ
 * listRecordsByPids で親 id 群に紐づく子レコードを取得し、pid ごとの件数のみ集計する。
 *
 * includeChildData フラグでは絞らない（クエリでは Webhook/印刷とは別目的で件数を出したいため）。
 *
 * @param {Object} args
 * @param {Array}  args.schema      親フォーム schema
 * @param {Array<string>} args.parentIds 親レコード id 群（重複可、内部で dedup）
 * @param {string} [args.baseUrl]   childFormUrl 生成用の Web アプリ URL
 * @param {Function} [args.listRecordsByPids] 注入用（テスト）。未指定なら gasClient の実体を使う。
 * @returns {Promise<Array<{ path:string, byPid: Map<string, {childFormId,childFormName,childFormUrl,count}> }>>}
 */
export const buildChildFormInjections = async ({ schema, parentIds, baseUrl = "", listRecordsByPids: listFn } = {}) => {
  const fields = collectFormLinkFields(schema);
  if (fields.length === 0) return [];
  const fetchByPids = typeof listFn === "function" ? listFn : (hasScriptRun() ? listRecordsByPids : null);
  if (typeof fetchByPids !== "function") return [];

  const pids = Array.from(new Set((Array.isArray(parentIds) ? parentIds : []).map((x) => String(x || "")).filter(Boolean)));
  const out = [];
  for (const field of fields) {
    let grouped = new Map();
    if (pids.length > 0) {
      try {
        const records = await fetchByPids({ formId: field.childFormId, pids });
        grouped = distributeChildRecordsByPid(records);
      } catch (_e) {
        grouped = new Map(); // 取得失敗時は件数 0（無言）。
      }
    }
    const byPid = new Map();
    for (const pid of pids) {
      const recs = grouped.get(pid) || [];
      byPid.set(pid, {
        childFormId: field.childFormId,
        childFormName: field.childFormName,
        childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, pid),
        count: recs.length,
      });
    }
    out.push({ path: field.path, byPid });
  }
  return out;
};
