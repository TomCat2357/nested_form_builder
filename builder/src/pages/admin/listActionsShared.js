/**
 * admin 一覧アクション hook（useAdminFormListActions / useAdminAnalyticsListActions）が共有する
 * エクスポート用 DL フローとダイアログ対象 ID 解決のヘルパー。
 */

import JSZip from "jszip";
import { sanitizeFileBaseName, triggerBlobDownload } from "../../utils/fileDownload.js";
import { hasScriptRun } from "../../services/gasClient.js";
import { normalizeFolderPath, folderExists } from "../../utils/folderTree.js";

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

/**
 * フォーム / Question・Dashboard 一覧で共通の「移動」アクション（選択→ダイアログ→確定）を生成する。
 * forms と analytics でダイアログ state / moveItems の ID キー名だけが異なる（formIds / itemIds）ため
 * idsKey で吸収する。挙動: 楽観的 UI（ダイアログを先に閉じて GAS をバックグラウンド実行）。
 *
 * @param {Object} cfg
 * @param {string} cfg.idsKey ダイアログ state と moveItems ペイロードで使う ID 配列のキー
 * @param {() => { ids: string[], folderPaths: string[] }} cfg.collectSelection 選択中の ID / フォルダ
 * @param {string} cfg.emptySelectionMessage 未選択時のアラート文言
 * @returns {{ handleMoveSelected: () => void, confirmMove: () => void }}
 */
export function createMoveActions({
  idsKey,
  collectSelection,
  emptySelectionMessage,
  moveDialog,
  moveDest,
  setMoveDest,
  setMoveError,
  registeredFolders,
  moveItems,
  clearSelectionByIds,
  clearFolderSelection,
  showAlert,
  onError,
}) {
  const handleMoveSelected = () => {
    if (!hasScriptRun()) {
      showAlert("移動はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const { ids, folderPaths } = collectSelection();
    if (!ids.length && !folderPaths.length) {
      showAlert(emptySelectionMessage);
      return;
    }
    setMoveDest("");
    setMoveError("");
    moveDialog.open({ [idsKey]: ids, folderPaths, count: ids.length + folderPaths.length });
  };

  const confirmMove = () => {
    const ids = Array.isArray(moveDialog.state[idsKey]) ? moveDialog.state[idsKey] : [];
    const folderPaths = Array.isArray(moveDialog.state.folderPaths) ? moveDialog.state.folderPaths : [];
    const destPath = normalizeFolderPath(moveDest);

    // クライアント側の存在チェック（最終判定はサーバ）。空欄=最上位は常に許可。
    if (destPath && !folderExists(registeredFolders, destPath)) {
      setMoveError(`移動先フォルダ「${destPath}」が存在しません`);
      return;
    }
    // フォルダを自身/配下へ移動しようとしていないか
    for (const old of folderPaths) {
      const o = normalizeFolderPath(old);
      if (destPath === o || destPath.startsWith(o + "/")) {
        setMoveError(`フォルダ「${o}」を自身またはその配下へは移動できません`);
        return;
      }
    }

    // ダイアログを先に閉じ、GAS はバックグラウンドで実行（完了後にリスト自動更新）。
    if (ids.length) clearSelectionByIds(ids);
    if (folderPaths.length && clearFolderSelection) clearFolderSelection();
    moveDialog.reset();
    setMoveDest("");
    setMoveError("");
    moveItems({ [idsKey]: ids, folderPaths, destPath }).catch((error) => {
      if (onError) onError(error);
      showAlert(error?.message || "移動に失敗しました");
    });
  };

  return { handleMoveSelected, confirmMove };
}
