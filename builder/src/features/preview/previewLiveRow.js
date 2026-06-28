import { collectResponses } from "../../core/collect.js";
import { buildLiveViewRow } from "../analytics/entriesToViewRows.js";

// 現レコードの「入力中ライブ値」を view 行に変換する純関数。保存と同じ collectResponses →
// entriesToViewTableRows 経路を使うので、キャッシュ行と同形状になり `_form` の現レコード行を
// 上書きできる（自己参照・新規レコードでも入力中の値で full-query が解決する）。
//
// buildLiveRow を注入可能にしてあるのはテスト用（既定は analytics の buildLiveViewRow）。
//
// @param {Object} args
// @param {Array}  args.schema           フォーム schema
// @param {Object} args.settings         { formId, recordNo, createdAt, createdBy, modifiedBy }
// @param {string} args.recordId         現レコード id（recordIdRef.current）
// @param {Object} args.responses        入力中の responses（id-keyed）
// @param {Function} [args.buildLiveRow] view 行ビルダ（注入用）。既定は buildLiveViewRow。
// @returns {Object|null}
export function buildPreviewLiveRow({ schema, settings = {}, recordId, responses, buildLiveRow = buildLiveViewRow }) {
  const liveEntry = {
    id: recordId,
    "No.": settings.recordNo,
    data: collectResponses(schema, responses || {}),
    createdAt: settings.createdAt,
    createdBy: settings.createdBy,
    modifiedBy: settings.modifiedBy,
  };
  return buildLiveRow({ id: settings.formId || "", schema }, liveEntry);
}
