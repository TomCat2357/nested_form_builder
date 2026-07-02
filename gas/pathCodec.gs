// =============================================
// Path Codec — フィールド/フォルダ階層パスの可逆エスケープ共有コーデック。
//
// 実装は builder/src/utils/pathCodec.js（+ headerToAlaSqlKey.js）が単一ソース。
// esbuild で gas/generated/nfbAlasqlUdfs.gs（グローバル `NfbAlasqlRuntime`）に
// 焼き込まれ、本ファイルの Nfb_* は薄いデリゲートのみ（公開関数名は従来どおり）。
// 配線の等価性は tests/path-codec-equivalence.test.cjs が担保。
// =============================================

var NFB_PATH_SEP = "/";

// 1 セグメント内の `\` と sep をバックスラッシュでエスケープする。
function Nfb_escapeSegment_(segment, sep) {
  return NfbAlasqlRuntime.escapeSegment(segment, sep);
}

// セグメント配列 → エスケープ付き sep 連結（フィルタ・trim はしない）。
function Nfb_joinEscaped_(segments, sep) {
  return NfbAlasqlRuntime.joinEscaped(segments, sep);
}

// エスケープ付き文字列 → セグメント配列（生トークン。空要素も含む。trim しない）。
function Nfb_splitEscaped_(text, sep, allowQuotes) {
  return NfbAlasqlRuntime.splitEscaped(text, sep, allowQuotes);
}

// セグメント配列 → 正準 "/" 連結（埋め込み "/" / "\" をバックスラッシュエスケープ）。
function Nfb_joinFieldPath_(segments) {
  return NfbAlasqlRuntime.joinFieldPath(segments);
}

// ユーザー入力文字列 → セグメント配列（クォート/バックスラッシュ両受理・trim・空要素除去）。
function Nfb_splitFieldPath_(path) {
  return NfbAlasqlRuntime.splitFieldPath(path);
}

// 内部キー（保存層 / 列キー）専用の "/" 分解。クォート無し・trim 無し・空要素も保持。
function Nfb_splitFieldKey_(key) {
  return NfbAlasqlRuntime.splitFieldKey(key);
}

// 列キー（"/" 連結・"\/" エスケープ対応、legacy "|" も区切り受理）→ AlaSQL 安全列名（"__" 連結）。
// 固定列 "No." は行ビルダの実キー "No_" にエイリアスする（フロントと同じ特別扱い）。
function Nfb_headerKeyToAlaSqlKey_(key) {
  return NfbAlasqlRuntime.headerKeyToAlaSqlKey(key);
}
