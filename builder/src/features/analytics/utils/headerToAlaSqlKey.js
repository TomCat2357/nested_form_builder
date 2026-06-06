import { splitEscaped } from "../../../utils/pathCodec.js";

/**
 * 列キー（パス連結文字列）を AlaSQL 安全な列名（`__` 連結）に変換する。
 * 例: "基本情報/区" → "基本情報__区"。固定列（id, createdAt 等）はそのまま返る。
 *
 * 区切りは新形式の `/`（`\/` エスケープ対応）。加えて **legacy の `|` も区切りとして受理** する。
 * 旧フィールドパス（`基本情報|区`）は `|` の区切り、新形式（`基本情報/区`）は `/` の区切りで
 * 同じ `基本情報__区` に落ちるため、保存済みダッシュボードの旧 pipePath 参照も移行なしで解決できる。
 * （`|` は新仕様では通常文字だが、旧データ互換のため区切りとしても解釈する。同名衝突は
 *  従来の `__` 連結が持つ既知の縁ケースと同じ範囲で、悪化させない。）
 */
export function headerKeyToAlaSqlKey(key) {
  if (!key) return "";
  const out = [];
  // まず "/"（"\/" エスケープ対応）でセグメント化し、各セグメントをさらに legacy "|" で分割。
  const parts = splitEscaped(String(key), "/", false);
  for (let i = 0; i < parts.length; i++) {
    const sub = parts[i].split("|");
    for (let j = 0; j < sub.length; j++) out.push(sub[j]);
  }
  return out.join("__");
}
