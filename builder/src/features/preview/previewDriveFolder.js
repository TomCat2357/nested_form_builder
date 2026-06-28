// PreviewPage の印刷様式出力結果から、対象 fileUpload フィールドの Drive フォルダ状態へ
// 反映する「次状態」を計算する純関数。状態更新の本体ロジックだけを切り出し、
// onFieldDriveFolderStateChange のリデューサ内から呼ぶ（挙動は不変）。

import {
  appendDriveFileId,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";

/**
 * 印刷様式出力結果（executeRecordOutputAction の戻り値）から、Drive フォルダ状態の次状態を組む。
 *
 * - result.folderUrl があればそれを resolvedUrl に採用、無ければ現在の有効 URL を維持。
 * - inputUrl は未入力なら resolvedUrl で埋める（手入力済みなら尊重）。
 * - autoCreated は「同一 URL で自動作成済み」を維持、または result.autoCreated===true で立てる。
 * - pendingPrintFileIds に result.fileId を追記する（重複排除は appendDriveFileId が担う）。
 *
 * @param {Object} prev   現在の正規化済み Drive フォルダ状態
 * @param {Object} result executeRecordOutputAction の戻り値（folderUrl / fileId / autoCreated 等）
 * @returns {Object} 次の Drive フォルダ状態（prev を spread した不変オブジェクト）
 */
export function computeNextDriveFolderStateFromPrintResult(prev, result) {
  const currentEffectiveFolderUrl = resolveEffectiveDriveFolderUrl(prev);
  const nextResolvedUrl = typeof result?.folderUrl === "string" && result.folderUrl.trim()
    ? result.folderUrl.trim()
    : (currentEffectiveFolderUrl || prev.resolvedUrl);
  const keepAutoCreated = prev.autoCreated && prev.resolvedUrl.trim() && prev.resolvedUrl.trim() === nextResolvedUrl;
  return {
    ...prev,
    resolvedUrl: nextResolvedUrl,
    inputUrl: prev.inputUrl.trim() ? prev.inputUrl : nextResolvedUrl,
    autoCreated: keepAutoCreated || result?.autoCreated === true,
    pendingPrintFileIds: appendDriveFileId(prev.pendingPrintFileIds, result?.fileId),
  };
}
