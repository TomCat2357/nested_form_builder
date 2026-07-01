// =============================================
// Path Codec — フィールド/フォルダ階層パスの可逆エスケープ共有コーデック（GAS 双子）。
//
// フロント builder/src/utils/pathCodec.js と **同一規則**。区切り `/`、セグメント内の `\` と
// `/` はバックスラッシュエスケープ、パース時は任意でクォート（' / "）グルーピングを受理する。
// 等価性は tests/path-codec-equivalence.test.cjs が builder/src/utils/pathCodec.js と突き合わせて担保。
//
// フロント headerKeyToAlaSqlKey の双子は Nfb_headerKeyToAlaSqlKey_（"/" 区切り + legacy "|" 受理 → "__" 連結）。
// =============================================

var NFB_PATH_SEP = "/";

// 1 セグメント内の `\` と sep をバックスラッシュでエスケープする。
function Nfb_escapeSegment_(segment, sep) {
  var s = String(segment === null || segment === undefined ? "" : segment);
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch === "\\" || ch === sep) out += "\\";
    out += ch;
  }
  return out;
}

// セグメント配列 → エスケープ付き sep 連結（フィルタ・trim はしない）。
function Nfb_joinEscaped_(segments, sep) {
  if (!Array.isArray(segments)) return "";
  var out = [];
  for (var i = 0; i < segments.length; i++) out.push(Nfb_escapeSegment_(segments[i], sep));
  return out.join(sep);
}

// エスケープ付き文字列 → セグメント配列（生トークン。空要素も含む。trim しない）。
function Nfb_splitEscaped_(text, sep, allowQuotes) {
  var str = String(text === null || text === undefined ? "" : text);
  var tokens = [];
  var current = "";
  var escaping = false;
  var quote = null;
  var i = 0;
  while (i < str.length) {
    var ch = str[i];
    if (escaping) { current += ch; escaping = false; i++; continue; }
    if (ch === "\\") { escaping = true; i++; continue; }
    if (quote) {
      if (ch === quote) {
        if (str[i + 1] === quote) { current += quote; i += 2; continue; }
        quote = null; i++; continue;
      }
      current += ch; i++; continue;
    }
    if (allowQuotes && (ch === "'" || ch === '"')) { quote = ch; i++; continue; }
    if (ch === sep) { tokens.push(current); current = ""; i++; continue; }
    current += ch; i++;
  }
  if (escaping) current += "\\";
  tokens.push(current);
  return tokens;
}

// セグメント配列 → 正準 "/" 連結（埋め込み "/" / "\" をバックスラッシュエスケープ）。
function Nfb_joinFieldPath_(segments) {
  return Nfb_joinEscaped_(segments, NFB_PATH_SEP);
}

// ユーザー入力文字列 → セグメント配列（クォート/バックスラッシュ両受理・trim・空要素除去）。
function Nfb_splitFieldPath_(path) {
  if (path === null || path === undefined || path === "") return [];
  var raw = Nfb_splitEscaped_(path, NFB_PATH_SEP, true);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var seg = String(raw[i]).trim();
    if (seg) out.push(seg);
  }
  return out;
}

// 内部キー（保存層 / 列キー）専用の "/" 分解。クォート無し・trim 無し・空要素も保持。
function Nfb_splitFieldKey_(key) {
  if (key === null || key === undefined || key === "") return [];
  return Nfb_splitEscaped_(key, NFB_PATH_SEP, false);
}

// 列キー（"/" 連結・"\/" エスケープ対応、legacy "|" も区切り受理）→ AlaSQL 安全列名（"__" 連結）。
// フロント headerKeyToAlaSqlKey の双子。共通ケースでは "親/子"・"親|子" とも "親__子"。
// 固定列 "No." は画面表示どおり "No." と書けるよう、行ビルダの実キー "No_"
// （entriesToViewRows.js の row["No_"]）にエイリアスする（フロントと同じ特別扱い）。
function Nfb_headerKeyToAlaSqlKey_(key) {
  if (!key) return "";
  if (String(key) === "No.") return "No_";
  var out = [];
  var parts = Nfb_splitEscaped_(String(key), NFB_PATH_SEP, false);
  for (var i = 0; i < parts.length; i++) {
    var sub = parts[i].split("|");
    for (var j = 0; j < sub.length; j++) out.push(sub[j]);
  }
  return out.join("__");
}
