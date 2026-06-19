/**
 * レコードコピー時の「別フォームを開く（formLink）」子レコード複製ロジック。
 *
 * formLink 項目をコピー対象に選ぶと、コピー元レコードの子レコード（子フォームで
 * pid == コピー元 id を持つ行）を、子フォームに新しい id・pid == 新レコードの id で
 * 複製する。複製は非再帰（直接の子レコードのみ）。子フォームは formLink を持てない
 * 仕様（子フォーム文脈ではボタン非表示）のため孫は発生しない。
 */

import { ensureArray } from "../utils/arrays.js";
import { genRecordId } from "../core/ids.js";
import { listRecordsByPid, submitResponses } from "../services/gasClient.js";
import { invalidateChildForm } from "../app/state/childRecordsMemoryStore.js";

/**
 * 選択された項目 ID のうち、formLink 型かつ childFormId を持つトップレベル項目を抽出する。
 *
 * @param {string[]} selectedFieldIds RecordCopyDialog で選ばれた項目 ID
 * @param {Object<string, object>} topLevelFieldMap トップレベル項目 ID → field
 * @returns {{fieldId: string, childFormId: string}[]}
 */
export function selectFormLinkCopyTargets(selectedFieldIds, topLevelFieldMap) {
  const ids = ensureArray(selectedFieldIds);
  const map = topLevelFieldMap || {};
  const out = [];
  ids.forEach((fieldId) => {
    const field = map[fieldId];
    if (!field || field.type !== "formLink") return;
    const childFormId = typeof field.childFormId === "string" ? field.childFormId.trim() : "";
    if (!childFormId) return;
    out.push({ fieldId, childFormId });
  });
  return out;
}

/**
 * コピー元の子レコード 1 件から、複製保存用の payload を組む。
 * 保存済みの生データ（child.data）をそのまま再利用するため子フォーム schema は不要。
 *
 * @param {{data?: object}} child listRecordsByPid が返す子レコード
 * @param {string} newParentId 新しい親レコードの id（子の pid に刻む）
 */
export function buildChildCopyPayload(child, newParentId) {
  const data = (child && child.data && typeof child.data === "object") ? child.data : {};
  return {
    version: 1,
    id: genRecordId(),
    responses: data,
    order: Object.keys(data),
    pid: String(newParentId || "").trim(),
  };
}

/**
 * 保留中の formLink リンクについて、コピー元の子レコードを子フォームへ複製する。
 * 新しい親レコードが保存された後に呼ぶ（newParentId は確定済みの新親 id）。
 *
 * @param {{pending: {sourceRecordId: string, links: {fieldId: string, childFormId: string}[]}, newParentId: string, showToast?: Function, showAlert?: Function}} params
 * @returns {Promise<{copied: number, failed: number}>}
 */
export async function copyChildRecordsForLinks({ pending, newParentId, showToast, showAlert }) {
  const sourceRecordId = String(pending?.sourceRecordId || "").trim();
  const links = Array.isArray(pending?.links) ? pending.links : [];
  const parentId = String(newParentId || "").trim();

  if (!sourceRecordId || !parentId || links.length === 0) {
    return { copied: 0, failed: 0 };
  }

  let copied = 0;
  let failed = 0;

  // childFormId 重複（同じフォームを指す複数 formLink）は 1 回だけ複製する。
  const seenChildForms = new Set();
  for (const link of links) {
    const childFormId = String(link?.childFormId || "").trim();
    if (!childFormId || seenChildForms.has(childFormId)) continue;
    seenChildForms.add(childFormId);

    let children = [];
    try {
      children = await listRecordsByPid({ formId: childFormId, pid: sourceRecordId });
    } catch (error) {
      console.error("[childRecordCopy] failed to list source children:", error);
      failed += 1;
      continue;
    }

    // 直列保存（LockService 競合回避）。失敗は集計して続行（部分成功を許容）。
    for (const child of children) {
      const payload = buildChildCopyPayload(child, parentId);
      try {
        await submitResponses({ formId: childFormId, payload });
        copied += 1;
      } catch (error) {
        console.error("[childRecordCopy] failed to copy child record:", error);
        failed += 1;
      }
    }
    // 新しい子レコード（pid == 新親 id）を作ったので、親が参照する子レコード/件数キャッシュを無効化。
    void invalidateChildForm(childFormId);
  }

  if (copied > 0 && typeof showToast === "function") {
    showToast(`子レコード ${copied} 件をコピーしました`);
  }
  if (failed > 0 && typeof showAlert === "function") {
    showAlert(`子レコードのコピーで ${failed} 件失敗しました`);
  }

  return { copied, failed };
}
