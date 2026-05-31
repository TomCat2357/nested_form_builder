/**
 * 複数値（checkboxes 等の選択ラベル）を 1 セル文字列へ **可逆に** 連結／分解する共有 codec。
 *
 * - 区切りはカンマ `,`（`MULTI_VALUE_SEP`）。
 * - ラベル自体に含まれる `,` と `\` はバックスラッシュでエスケープ（`\` → `\\`、`,` → `\,`）。
 *   これによりラベルにカンマ・バックスラッシュ・前後空白が含まれても一意に往復できる。
 * - 保存（collect）／再読込（responses）／検索（splitMultiValue・MV_EQ/MV_IN）／
 *   分析 view 行（entriesToViewRows）の **正準区切り** はすべてこの codec を通す。
 *   ※ 表示用の `", "`（カンマ＋空白）連結は再パースされないためエスケープしない別経路。
 *
 * 単一ソース: フロントは本モジュールを直接 import。GAS 側は
 *   - MV_EQ/MV_IN は registerNfbUdfs.js が import → esbuild で gas/generated/nfbAlasqlUdfs.gs に焼き込み
 *   - その他 GAS ハンドコードは gasRuntimeEntry.js 経由で `NfbAlasqlRuntime.joinMultiValue` 等として参照
 * できる（formatCanonical 等と同じ集約方式）。
 */

export const MULTI_VALUE_SEP = ",";

function escapeLabel(label) {
  return String(label).replace(/\\/g, "\\\\").replace(/,/g, "\\,");
}

/**
 * ラベル配列 → エスケープ付きカンマ連結文字列。
 * null/undefined/空文字のラベルはスキップする（保存時に空要素を生まない）。
 * @param {Array<string>} labels
 * @returns {string}
 */
export function joinMultiValue(labels) {
  if (!Array.isArray(labels)) return "";
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    const lbl = labels[i];
    if (lbl === null || lbl === undefined) continue;
    const s = String(lbl);
    if (s === "") continue;
    out.push(escapeLabel(s));
  }
  return out.join(MULTI_VALUE_SEP);
}

/**
 * エスケープ付きカンマ連結文字列 → ラベル配列（joinMultiValue の逆）。
 * 未エスケープの `,` のみを区切りとし、`\` の直後 1 文字はリテラル化する。
 * 空トークン（連続/先頭/末尾カンマ由来）は除外。trim は行わない（ラベルの前後空白を保持）。
 * @param {string|null|undefined} text
 * @returns {Array<string>}
 */
export function splitMultiValue(text) {
  if (text === null || text === undefined) return [];
  const str = String(text);
  if (str === "") return [];
  const tokens = [];
  let current = "";
  let escaping = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaping) {
      current += ch;
      escaping = false;
    } else if (ch === "\\") {
      escaping = true;
    } else if (ch === MULTI_VALUE_SEP) {
      if (current !== "") tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (escaping) current += "\\"; // 末尾の孤立した "\" はリテラル扱い
  if (current !== "") tokens.push(current);
  return tokens;
}
