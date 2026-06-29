import {
  normalizeDriveFileIds,
  normalizeDriveFolderState,
} from "../utils/driveFolderState.js";

export const fallbackForForm = (formId, locationState) => {
  if (locationState?.from) return locationState.from;
  if (formId) return `/search?form=${formId}`;
  return "/";
};

export const toResponseObject = (value) => (value && typeof value === "object" ? value : {});

export const diffResponses = (prevValue, nextValue) => {
  const prev = toResponseObject(prevValue);
  const next = toResponseObject(nextValue);
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  const addedKeys = nextKeys.filter((key) => !Object.prototype.hasOwnProperty.call(prev, key));
  const removedKeys = prevKeys.filter((key) => !Object.prototype.hasOwnProperty.call(next, key));
  const changedKeys = nextKeys.filter((key) => Object.prototype.hasOwnProperty.call(prev, key) && prev[key] !== next[key]);

  return {
    prevCount: prevKeys.length,
    nextCount: nextKeys.length,
    addedKeys,
    removedKeys,
    changedKeys,
  };
};

export const sampleKeys = (keys, max = 8) => keys.slice(0, max);

export const toEntryVersion = (candidate) => {
  const value = Number(candidate?.modifiedAtUnixMs ?? candidate?.modifiedAt ?? 0);
  return Number.isFinite(value) ? value : 0;
};

export const pickLatestEntry = (current, incoming) => {
  if (!current) return incoming || null;
  if (!incoming) return current;
  const currentVersion = toEntryVersion(current);
  const incomingVersion = toEntryVersion(incoming);
  return incomingVersion > currentVersion ? incoming : current;
};

export const buildFolderUrlsByFieldFromStates = (states) => {
  const out = {};
  for (const [fid, st] of Object.entries(states || {})) {
    const normalized = normalizeDriveFolderState(st);
    const url = (normalized.resolvedUrl || normalized.inputUrl || "").trim();
    if (url) out[fid] = url;
  }
  return out;
};

// 各 fileUpload フィールドの論理パス（folderName）を { fieldId: folderName } で集める。
// 出力テンプレ（fileUploadMeta）やセル再構築で論理パスを運ぶために使う。
export const buildFolderNamesByFieldFromStates = (states) => {
  const out = {};
  for (const [fid, st] of Object.entries(states || {})) {
    const folderName = normalizeDriveFolderState(st).folderName.trim();
    if (folderName) out[fid] = folderName;
  }
  return out;
};

// レコードのアップロードフォルダは先頭 fileUpload 質問（primary）が所有する単一フォルダに集約される。
// 復元時、各カラム（field.id キー）から最初に見つかった folderUrl / folderName を拾い、primary state へ
// 集約するための値を返す。primary セルにファイルが無い旧データでも、他カラムのフォルダ情報を引き継げる。
export const aggregatePrimaryUploadFolder = (uploadFields, folderUrlsByField, folderNamesByField) => {
  const fields = Array.isArray(uploadFields) ? uploadFields : [];
  const urls = folderUrlsByField || {};
  const names = folderNamesByField || {};
  let url = "";
  let folderName = "";
  for (const field of fields) {
    const fid = field?.id;
    if (!fid) continue;
    if (!url && typeof urls[fid] === "string" && urls[fid]) url = urls[fid];
    if (!folderName && typeof names[fid] === "string" && names[fid]) folderName = names[fid];
    if (url && folderName) break;
  }
  return { url, folderName };
};

// 保存時、primary の確定フォルダ参照（folderUrl / folderName）を、実ファイルを持つ各 fileUpload セルへ配る。
// レコード内の全アップロードは単一フォルダ（primary 所有）に集約されるため、各セルが同一参照を持つことで
// 検索エクスポート・外部アクション payload・論理パス再リンクが field 単位で従来どおり機能する。
// ファイルを持たないカードには参照を付けない（「ファイル無し・フォルダリンクのみ」セルの増殖を避ける）。
export const broadcastPrimaryUploadFolder = (uploadFields, rawResponses, finalizedFolderUrlByField, finalizedFolderNameByField) => {
  const fields = Array.isArray(uploadFields) ? uploadFields : [];
  const responses = toResponseObject(rawResponses);
  const finalizedUrls = finalizedFolderUrlByField || {};
  const finalizedNames = finalizedFolderNameByField || {};
  const primaryFieldId = fields[0]?.id || "";
  const primaryUrl = primaryFieldId ? (finalizedUrls[primaryFieldId] || "") : "";
  const primaryName = primaryFieldId ? (finalizedNames[primaryFieldId] || "") : "";
  const folderUrls = {};
  const folderNames = {};
  fields.forEach((field) => {
    const fid = field?.id;
    if (!fid) return;
    const value = responses[fid];
    const hasFiles = Array.isArray(value) && value.length > 0;
    if (primaryUrl && hasFiles) {
      folderUrls[fid] = primaryUrl;
      folderNames[fid] = primaryName;
    } else {
      // primary 自身、またはファイルを持たないカードは従来の per-field 確定値を尊重する。
      folderUrls[fid] = finalizedUrls[fid] || "";
      folderNames[fid] = finalizedNames[fid] || "";
    }
  });
  return { folderUrls, folderNames };
};

export const collectDriveFileIds = (responses) => {
  const seen = new Set();
  Object.values(toResponseObject(responses)).forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      const fileId = typeof entry?.driveFileId === "string" ? entry.driveFileId.trim() : "";
      if (fileId) seen.add(fileId);
    });
  });
  return normalizeDriveFileIds(Array.from(seen));
};
