/**
 * フォーム一覧の Drive インポートで使う純粋ロジック。
 * useAdminFormListActions から分離し、React 非依存の純関数として単体テスト可能にする。
 * （取り込みワークフロー本体 startImportWorkflow / handleImportFromDrive は state 依存のため hook 側に残す。）
 */
import { toUnixMs } from "../../utils/dateTime.js";
import { asPlainObject } from "../../utils/objectShape.js";

/**
 * スキップ / 読込失敗の件数から「（…）」形式の補足文言を組み立てる。空なら "" を返す。
 */
export const buildImportDetail = (skipped = 0, parseFailed = 0, { useRegisteredLabel = false } = {}) => {
  const parts = [];
  if (skipped > 0) {
    const label = useRegisteredLabel ? "登録済み（リンク済み）スキップ" : "スキップ";
    parts.push(`${label} ${skipped} 件`);
  }
  if (parseFailed > 0) parts.push(`読込失敗 ${parseFailed} 件`);
  return parts.length > 0 ? `（${parts.join("、")}）` : "";
};

/**
 * Drive から取り込んだ生フォーム payload を保存用に正規化する。不正なら null。
 */
export const sanitizeImportedForm = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const schema = Array.isArray(raw.schema) ? raw.schema : [];
  const settings = asPlainObject(raw.settings);
  const createdAtUnixMs = toUnixMs(raw.createdAtUnixMs ?? raw.createdAt);
  const modifiedAtUnixMs = toUnixMs(raw.modifiedAtUnixMs ?? raw.modifiedAt);

  if (!settings.formTitle && typeof raw.name === "string") {
    settings.formTitle = raw.name;
  }

  return {
    id: raw.id,
    description: typeof raw.description === "string" ? raw.description : "",
    schema,
    settings,
    archived: !!raw.archived,
    readOnly: !!raw.readOnly,
    childOnly: !!raw.childOnly,
    schemaVersion: Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : 1,
    createdAt: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : raw.createdAt,
    modifiedAt: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : raw.modifiedAt,
    createdAtUnixMs: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : null,
    modifiedAtUnixMs: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : null,
  };
};

/**
 * Drive 取り込み結果（contents 配列）を保存キュー { form, fileId, fileUrl } に整形する。
 * form/fileId を欠く・正規化に失敗した要素は invalidPayloadCount に数える。
 */
export const flattenImportedContents = (contents) => {
  const list = [];
  let invalidPayloadCount = 0;
  (Array.isArray(contents) ? contents : []).forEach((item) => {
    if (item && item.form && item.fileId) {
      const sanitized = sanitizeImportedForm(item.form);
      if (sanitized) {
        list.push({ form: sanitized, fileId: item.fileId, fileUrl: item.fileUrl || null });
      } else {
        invalidPayloadCount += 1;
      }
    } else {
      invalidPayloadCount += 1;
    }
  });
  return { list, invalidPayloadCount };
};
