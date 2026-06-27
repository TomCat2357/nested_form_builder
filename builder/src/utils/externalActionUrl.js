// 外部アクション URL のユーティリティ。
// - URL のトークン解決は印刷様式と共通の alasql `{{...}}` エンジン（tokenReplacer）に統一済み。
//   本モジュールは「http(s) 検証」「旧・単括弧固定トークンの予約参照への自動マップ」
//   「機微予約トークンの管理者ゲート判定」のみを担う純ユーティリティ。
// - 機微トークン（_spreadsheet_id / _spreadsheet_url / _sheet_name / _drive_file_url / _user_email）
//   は adminOnly && isAdmin のときだけ展開を許可。違反時は送信側で URL を null 化して早期失敗させる。

import { asString } from "./strings.js";

const HTTP_URL_PATTERN = /^https?:\/\//i;

// 機微予約参照（バッククォート無しの素の名前）。これらが許可なく参照されたら送信を止める。
export const SENSITIVE_RESERVED_REFS = new Set([
  "_spreadsheet_id",
  "_spreadsheet_url",
  "_sheet_name",
  "_drive_file_url",
  "_user_email",
]);

// 旧・単括弧固定トークン（{id} 等）→ 新・alasql 予約参照名の対応。
// トークンは増やさない方針（統一性のための機構統合のみ）。
export const LEGACY_EXTERNAL_ACTION_TOKEN_MAP = Object.freeze({
  id: "_id",
  formId: "_form_id",
  formName: "_form_name",
  spreadsheetId: "_spreadsheet_id",
  spreadsheetUrl: "_spreadsheet_url",
  sheetName: "_sheet_name",
  driveFileUrl: "_drive_file_url",
  userEmail: "_user_email",
});

// 旧単括弧トークンだけを厳密一致で拾う（前後がブレースのものは除外＝二重括弧を壊さない）。
const LEGACY_TOKEN_PATTERN = /(?<!\{)\{(id|formId|formName|spreadsheetId|spreadsheetUrl|sheetName|driveFileUrl|userEmail)\}(?!\})/g;

export const buildSpreadsheetUrl = (spreadsheetId) => (
  spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : ""
);

// 素の fileId から Google ドキュメント編集 URL を組み立てる（印刷様式は fileId で保持・表示/出力で URL 復元）。
export const buildDocumentUrl = (fileId) => (
  fileId ? `https://docs.google.com/document/d/${fileId}/edit` : ""
);

// driveFileId から Drive ファイルを開く URL を決定的に構成する。driveFileUrl は非永続なので
// 取得済みレコードでは空のことが多いが、driveFileId は永続化されているため再構成できる。
export const buildDriveFileViewUrl = (driveFileId) => (
  driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : ""
);

export const isValidExternalActionUrl = (url) => {
  if (typeof url !== "string") return false;
  return HTTP_URL_PATTERN.test(url.trim());
};

// 旧 外部アクション URL（`{id}` 等の単括弧固定トークン）を alasql 予約参照 `` {{`_id`}} `` へ
// 自動マップする。冪等：対象は 8 個の完全一致のみ・既に `{{...}}` のものは触らない。
export const migrateLegacyExternalActionUrlTokens = (url) => {
  if (typeof url !== "string" || url.indexOf("{") < 0) return asString(url);
  return url.replace(LEGACY_TOKEN_PATTERN, (_match, name) => {
    const reserved = LEGACY_EXTERNAL_ACTION_TOKEN_MAP[name];
    return reserved ? "{{`" + reserved + "`}}" : _match;
  });
};

// テンプレ中で参照された予約名（extractReservedRefs の結果）に、許可されていない機微参照が
// 含まれるかを判定する。true なら送信側で URL を null 化して早期失敗させる。
export const hasBlockedSensitiveRefs = (reservedRefs, gate) => {
  const allowed = gate && gate.adminOnly === true && gate.isAdmin === true;
  if (allowed) return false;
  return (reservedRefs || []).some((name) => SENSITIVE_RESERVED_REFS.has(name));
};
