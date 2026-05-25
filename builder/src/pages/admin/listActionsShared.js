/**
 * admin 一覧アクション hook（useAdminFormListActions / useAdminAnalyticsListActions）が共有する
 * エクスポート用 DL フローとダイアログ対象 ID 解決のヘルパー。
 */

import JSZip from "jszip";
import { sanitizeFileBaseName, triggerBlobDownload } from "../../utils/fileDownload.js";

export { sanitizeFileBaseName };

const zipTimestamp = () => new Date().toISOString().replace(/[:.-]/g, "");

/**
 * items を JSON 1 ファイル（単体）または ZIP（複数）でダウンロードさせる。
 * @param {Array<Object>} items
 * @param {{ entryName: (item: Object, ctx: {index: number, total: number}) => string, zipPrefix: string }} opts
 *   entryName は拡張子なし・サニタイズ済みのベース名を返す。zipPrefix は `${zipPrefix}_<timestamp>.zip` に使う。
 */
export async function downloadJsonOrZip(items, { entryName, zipPrefix }) {
  if (items.length === 1) {
    const blob = new Blob([JSON.stringify(items[0], null, 2)], { type: "application/json" });
    triggerBlobDownload(blob, `${entryName(items[0], { index: 0, total: 1 })}.json`);
    return;
  }
  const zip = new JSZip();
  items.forEach((item, index) => {
    zip.file(`${entryName(item, { index, total: items.length })}.json`, JSON.stringify(item, null, 2));
  });
  const blob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(blob, `${zipPrefix}_${zipTimestamp()}.zip`);
}

/**
 * ConfirmDialog の state から対象 ID 配列を解決する。
 * 複数選択なら state.targetIds、単体なら [state[idKey]]、どちらも無ければ []。
 */
export function resolveDialogTargetIds(state, idKey = "id") {
  if (state && Array.isArray(state.targetIds) && state.targetIds.length) return state.targetIds;
  if (state && state[idKey]) return [state[idKey]];
  return [];
}
