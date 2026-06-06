/**
 * 区切り文字 + バックスラッシュ（任意でクォート）による **可逆エスケープ** の共有コーデック。
 *
 * 階層を表す区切り文字を 1 か所に集約するための土台。次の 2 系統が本モジュールを共有する:
 *   - フィールド/フォルダ階層パス（区切り = スラッシュ `/`）… joinFieldPath / splitFieldPath / splitFieldKey
 *   - 複数値（チェックボックス）ラベル（区切り = カンマ `,`）… multiValue.js が escapeSegment/joinEscaped/splitEscaped を流用
 *
 * エスケープ規則（区切り共通）:
 *   - セグメント内の `\` と「区切り文字そのもの」はバックスラッシュでエスケープ（`\` → `\\`、`/` → `\/`、`,` → `\,`）。
 *   - パース時、`\` は常に次 1 文字をリテラル化する（クォート内でも有効）。
 *   - allowQuotes 時のみ、`'` / `"` で囲んだ区間内では区切り文字を無視し、同じクォートを 2 個重ねるとクォート自身を表す（`''`）。
 *   - **正準シリアライズはバックスラッシュのみ**（クォートは出力しない）。`["親","子/供"]` → `親/子\/供`。
 *
 * 単一ソース: フロントは本モジュールを直接 import。GAS 側は registerNfbUdfs.js / gasRuntimeEntry.js 経由で
 * 焼き込む（multiValue.js と同じ集約方式）。等価性は tests/path-codec-equivalence.test.cjs が担保。
 */

export const PATH_SEP = "/";

/**
 * 1 セグメント内の `\` と sep をバックスラッシュでエスケープする。
 * @param {*} segment
 * @param {string} sep 1 文字の区切り
 * @returns {string}
 */
export function escapeSegment(segment, sep) {
  const s = String(segment === null || segment === undefined ? "" : segment);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" || ch === sep) out += "\\";
    out += ch;
  }
  return out;
}

/**
 * セグメント配列 → エスケープ付き sep 連結文字列。フィルタ・trim はしない（呼び出し側の責務）。
 * @param {Array<*>} segments
 * @param {string} sep
 * @returns {string}
 */
export function joinEscaped(segments, sep) {
  if (!Array.isArray(segments)) return "";
  const out = [];
  for (let i = 0; i < segments.length; i++) out.push(escapeSegment(segments[i], sep));
  return out.join(sep);
}

/**
 * エスケープ付き文字列 → セグメント配列（生トークン。空要素も含む。trim しない）。
 * @param {string|null|undefined} text
 * @param {string} sep 1 文字の区切り
 * @param {boolean} allowQuotes クォート（' / "）でのグルーピングを許可するか
 * @returns {Array<string>}
 */
export function splitEscaped(text, sep, allowQuotes) {
  const str = String(text === null || text === undefined ? "" : text);
  const tokens = [];
  let current = "";
  let escaping = false;
  let quote = null; // クォート内ならそのクォート文字
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (escaping) {
      current += ch;
      escaping = false;
      i++;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        if (str[i + 1] === quote) { current += quote; i += 2; continue; } // クォート重ね = リテラル
        quote = null;
        i++;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (allowQuotes && (ch === "'" || ch === '"')) {
      quote = ch;
      i++;
      continue;
    }
    if (ch === sep) {
      tokens.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (escaping) current += "\\"; // 末尾の孤立した "\" はリテラル扱い
  tokens.push(current);
  return tokens;
}

/**
 * セグメント配列 → 正準 "/" 連結文字列（埋め込み "/" と "\" をバックスラッシュエスケープ）。
 * フィールド階層キー・フォルダパスの正準シリアライズに使う。
 * @param {Array<*>} segments
 * @returns {string}
 */
export function joinFieldPath(segments) {
  return joinEscaped(segments, PATH_SEP);
}

/**
 * ユーザー入力文字列 → セグメント配列（クォート/バックスラッシュ両エスケープ受理・trim・空要素除去）。
 * 検索バー / テンプレート項目参照 / 列名解決で使う「人が打つパス」用。
 * @param {string|null|undefined} path
 * @returns {Array<string>}
 */
export function splitFieldPath(path) {
  if (path === null || path === undefined || path === "") return [];
  const raw = splitEscaped(path, PATH_SEP, true);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i].trim();
    if (seg) out.push(seg);
  }
  return out;
}

/**
 * 内部キー（保存層 / 列キー）専用の "/" 分解。クォート無し・trim 無し・空要素も保持の素直な往復。
 * joinFieldPath とちょうど逆変換。collect / sheetsHeaders 等の機械生成キーに使う。
 * @param {string|null|undefined} key
 * @returns {Array<string>}
 */
export function splitFieldKey(key) {
  if (key === null || key === undefined || key === "") return [];
  return splitEscaped(key, PATH_SEP, false);
}
