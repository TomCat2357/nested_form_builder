import { useEffect, useMemo, useRef, useState } from "react";
import { ensureArray } from "../../utils/arrays.js";
import { hasScriptRun, countRecordsByPid, listRecordsByPids } from "../../services/gasClient.js";
import { buildChildFormUrl } from "../../utils/formShareUrl.js";
import { buildChildDataObject, getChildFormCached_ } from "./childFormData.js";
import {
  getChildRecordsFromCache,
  saveChildDataToCache,
  saveChildCountToCache,
  subscribeChildFormChange,
} from "../../app/state/childRecordsMemoryStore.js";
import { evaluateCacheForRecords } from "../../app/state/cachePolicy.js";
import { getRecordsFromCache } from "../../app/state/recordsMemoryStore.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";

// 「別フォームを開く（formLink）」項目の子レコード件数バッジ・取り込み子データ（childFormMeta）を
// 取得/再計算する state ＋ effect を集約したカスタムフック。PreviewPage から挙動・依存配列を
// そのまま切り出している（cache-first → SWR 検証 → childRecordsMemoryStore の変更購読で再計算）。
//
// @returns {{ formLinkChildCounts: Object, childFormMeta: Object }}
export function useFormLinkChildData({
  formLinkFields,
  formLinkSignature,
  inChildContext,
  recordIdRef,
  recordId, // settings.recordId（保存済み id 有無の判定に使う）
  modifiedAtUnixMs, // settings.modifiedAtUnixMs
  // 子レコード変化（subscribe 通知）時に full-query 再解決を促すための epoch 進行関数。
  // useState の setter は識別子が安定なので、購読 effect の依存配列に影響しない。
  bumpChildReadyEpoch,
}) {
  const [formLinkChildCounts, setFormLinkChildCounts] = useState({});
  // 子フォームの合成オブジェクト（fieldId → { childFormId, childFormName, childFormUrl, count, records }）。
  // 全 formLink 項目を詰める。外部アクション 送信・印刷・プレビューの CHILD_FORM_* で参照。
  const [formLinkChildData, setFormLinkChildData] = useState({});

  // 別レコードを開いた瞬間の残像を防ぐためのリセット判定 / 親再同期の強制更新判定に使う。
  const prevChildRecordIdRef = useRef(null);
  const prevChildModifiedAtRef = useRef(undefined);
  useCancellable(async (isCancelled) => {
    const currentRecordId = recordIdRef.current;
    // レコードが切り替わった時だけ state をリセット（同一レコードの再評価ではキャッシュ即表示を維持）。
    const recordChanged = prevChildRecordIdRef.current !== currentRecordId;
    // 同一レコードで modifiedAtUnixMs が変わった＝親が再同期された → 子データを強制再取得。
    const parentChanged =
      !recordChanged &&
      prevChildModifiedAtRef.current !== undefined &&
      prevChildModifiedAtRef.current !== modifiedAtUnixMs;
    prevChildRecordIdRef.current = currentRecordId;
    prevChildModifiedAtRef.current = modifiedAtUnixMs;
    if (recordChanged) {
      setFormLinkChildCounts({});
      setFormLinkChildData({});
    }
    if (inChildContext) return;
    if (!recordId || !currentRecordId) return;
    if (!hasScriptRun()) return;
    if (formLinkFields.length === 0) return;
    const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";

    // 1 項目ぶんの取得 → state 反映 → キャッシュ書き戻し。shouldSync は await、shouldBackground は
    // fire-and-forget で使う。state 反映はキャンセルガードするが、キャッシュ書き戻しは常に行う。
    const fetchField = async (field) => {
      if (typeof listRecordsByPids === "function") {
        // 子レコード全件 + 子 schema を取得し、合成オブジェクトを組む（件数も records から導出）。
        // 全 formLink で常に詳細を取得し、外部アクション/印刷の items 列へ展開できるようにする。
        const [childForm, records] = await Promise.all([
          getChildFormCached_(field.childFormId),
          listRecordsByPids({ formId: field.childFormId, pids: [currentRecordId] }),
        ]);
        const childObj = buildChildDataObject({
          childFormId: field.childFormId,
          childFormName: field.childFormName,
          childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, currentRecordId),
          childSchema: childForm && childForm.schema ? childForm.schema : [],
          records,
        });
        await saveChildDataToCache(field.childFormId, currentRecordId, childObj);
        if (isCancelled()) return;
        setFormLinkChildData((prev) => ({ ...prev, [field.id]: childObj }));
        setFormLinkChildCounts((prev) => ({ ...prev, [field.id]: childObj.count }));
      } else if (typeof countRecordsByPid === "function") {
        const count = await countRecordsByPid({ formId: field.childFormId, pid: currentRecordId });
        await saveChildCountToCache(field.childFormId, currentRecordId, count);
        if (isCancelled()) return;
        setFormLinkChildCounts((prev) => ({ ...prev, [field.id]: count }));
      }
    };

    for (const field of formLinkFields) {
      try {
        const kind = "detail";
        const cached = await getChildRecordsFromCache(field.childFormId, currentRecordId, { kind });
        if (isCancelled()) return;
        // キャッシュ即表示（cache-first）。
        if (cached.hasData) {
          if (kind === "detail" && cached.childData) {
            setFormLinkChildData((prev) => ({ ...prev, [field.id]: cached.childData }));
          }
          setFormLinkChildCounts((prev) => ({ ...prev, [field.id]: cached.count }));
        }
        const { shouldSync, shouldBackground } = evaluateCacheForRecords({
          lastSyncedAt: cached.lastSyncedAt,
          hasData: cached.hasData,
          forceSync: parentChanged,
        });
        if (shouldSync) {
          await fetchField(field);
          if (isCancelled()) return;
        } else if (shouldBackground) {
          // 裏で再検証（非ブロッキング）。内部で isCancelled ガード済み。
          fetchField(field).catch(() => {});
        }
      } catch (_e) {
        // 取得失敗時はバッジ / 子データを出さない（無言）。
      }
    }
  }, [recordId, modifiedAtUnixMs, formLinkSignature, inChildContext]);

  // オーバーレイ等で子レコードが保存/複製されると childRecordsMemoryStore が invalidate される。
  // その通知を受けて、親プレビューの「子件数バッジ・取り込み子データ（includeChildData）・
  // full-query({{SELECT}}) 集計」を再計算する。再計算はローカル warm ストア（recordsMemoryStore：
  // 楽観保存で更新済み）から行うのでサーバ往復せず、背景のスプレッドシート書き込み完了を待たずに
  // 即座に正しい値へ反映できる（保存直後のサーバ未反映によるレースを避ける）。
  useEffect(() => {
    if (inChildContext) return undefined;
    const childIds = new Set(formLinkFields.map((f) => f.childFormId));
    if (childIds.size === 0) return undefined;
    const unsubscribe = subscribeChildFormChange((changedChildFormId) => {
      if (!childIds.has(changedChildFormId)) return;
      const currentRecordId = recordIdRef.current;
      if (!currentRecordId) return;
      const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
      (async () => {
        for (const field of formLinkFields) {
          if (field.childFormId !== changedChildFormId) continue;
          try {
            const cache = await getRecordsFromCache(field.childFormId);
            const recs = (ensureArray(cache.entries))
              .filter((e) => String(e?.pid ?? "") === currentRecordId)
              .filter((e) => !(e?.deletedAtUnixMs || e?.deletedAt));
            // 全 formLink で常に詳細を再構築する（メイン取得 effect と同じ always-detail 方針）。
            const childForm = await getChildFormCached_(field.childFormId);
            const childObj = buildChildDataObject({
              childFormId: field.childFormId,
              childFormName: field.childFormName,
              childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, currentRecordId),
              childSchema: childForm && childForm.schema ? childForm.schema : [],
              records: recs,
            });
            setFormLinkChildData((prev) => ({ ...prev, [field.id]: childObj }));
            setFormLinkChildCounts((prev) => ({ ...prev, [field.id]: childObj.count }));
            await saveChildDataToCache(field.childFormId, currentRecordId, childObj);
          } catch (_e) { /* 再計算失敗は無言（次回の通常再取得で整合） */ }
        }
        // full-query（{{SELECT}}）置換も子レコード変化に追従させる（warm ストアは更新済み）。
        bumpChildReadyEpoch();
      })();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formLinkSignature, inChildContext]);

  // 全 formLink 項目の { fieldId: 合成オブジェクト } マップ。外部アクション の record.items 展開・
  // 印刷 payload（items 展開 + driveSettings.childFormMeta）・プレビュー row 注入で共有する。
  const childFormMeta = useMemo(() => {
    const out = {};
    for (const field of formLinkFields) {
      const obj = formLinkChildData[field.id];
      if (obj) out[field.id] = obj;
    }
    return out;
  }, [formLinkFields, formLinkChildData]);

  return { formLinkChildCounts, childFormMeta };
}
