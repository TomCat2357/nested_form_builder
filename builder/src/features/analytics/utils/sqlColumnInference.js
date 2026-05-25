/**
 * SQL の SELECT 句から compiledColumns 互換のメタ配列を構築する。
 *
 * GUI モード (compileStages) は role/type を直接出力できるが、SQL モードは
 * AlaSQL 実行結果しか持たないため、UI 側の detectColumnType が型を解決できず
 * 棒/折れ線/円グラフが描画できなくなる回帰が起きる（commit e48adb1 以降）。
 *
 * このモジュールは SELECT 句を文字列パースして以下を判定する:
 *   - 集計関数のエイリアス → role: "metric"
 *     - COUNT/COUNT_DISTINCT/SUM/AVG/STDEV/STDEVP/VAR/VARP → type: "number"
 *     - MIN/MAX/FIRST/LAST → 引数列の type を fallbackTypeMap で継承
 *   - 単純なカラム参照 → role: "dimension" / type は fallbackTypeMap から
 *   - SELECT * / 解析不能式 → null（呼び出し側は UI を degrade）
 *
 * 実装は 3 モジュールに分割している:
 *   - sqlMaskScanner.js: マスキングと SELECT/カンマ/AS のトップレベル分割
 *   - sqlExprParse.js:    カラム参照 / 集計関数 / CAST の式パース
 *   - sqlColumnInference.js: それらを束ねて compiledColumns 互換配列を返す
 */

import { headerKeyToAlaSqlKey } from "./headerToAlaSqlKey.js";
import { lookupTypeFromMap } from "./columnTypeLookup.js";
import { maskTokens, findSelectFromRange, splitSelectColumns, splitExprAndAlias } from "./sqlMaskScanner.js";
import { stripIdentifierWrap, tryAsColumnRef, tryAsAggregate, tryAsCast } from "./sqlExprParse.js";

const NUMBER_AGGS = new Set(["COUNT", "SUM", "AVG", "STDEV", "STDEVP", "VAR", "VARP"]);
const INHERIT_AGGS = new Set(["MIN", "MAX", "FIRST", "LAST"]);

/**
 * SQL（preprocessSql 適用後を想定）から compiledColumns 互換配列を返す。
 *
 * @param {string} sql
 * @param {Map<string,string>|object|null} fallbackTypeMap
 *   キー = AlaSQL safe key (headerKeyToAlaSqlKey 通過後)。値 = "number"|"date"|"string"|"boolean"|"unknown"。
 * @returns {Array<{name:string, role:"dimension"|"metric"|null, type:string|null, aggType?:string}>|null}
 */
export function inferCompiledColumnsFromSql(sql, fallbackTypeMap) {
  if (typeof sql !== "string" || !sql.trim()) return null;
  const masked = maskTokens(sql);
  const range = findSelectFromRange(masked);
  // FROM 不在 (FROM-less SELECT) は range.end が末尾になるので OK
  if (!range) return null;

  const partsTrimmed = splitSelectColumns(sql, masked, range);
  if (partsTrimmed.length === 0) return null;
  // SELECT * / SELECT alias.* は型解決不能 (列メタ自体は呼び出し側で columns から再構築される)
  if (partsTrimmed.some((p) => p.trim() === "*" || /^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*\*$/.test(p.trim()))) return null;

  const lookup = (rawName) => {
    if (!rawName) return null;
    return lookupTypeFromMap(fallbackTypeMap, headerKeyToAlaSqlKey(rawName));
  };

  const out = [];
  for (const raw of partsTrimmed) {
    const { exprPart, aliasPart } = splitExprAndAlias(raw);
    const aliasName = aliasPart ? stripIdentifierWrap(aliasPart) : null;

    // CAST(... AS <type>) — tryAsAggregate より先にチェック（CAST は集計関数ではないが
    // tryAsAggregate の `[A-Za-z_]+\(...\)` 形状にもマッチしてしまうため）。
    // alias がある場合のみ登録（AlaSQL の自動出力名と一致させにくいため）。
    const cast = tryAsCast(exprPart);
    if (cast) {
      if (aliasName) {
        out.push({ name: aliasName, role: "dimension", type: cast.type });
      }
      continue;
    }

    const agg = tryAsAggregate(exprPart);
    if (agg) {
      const fn = agg.fn;
      let type = null;
      let role = null;
      let aggType;
      if (NUMBER_AGGS.has(fn)) {
        type = "number";
        role = "metric";
        aggType = fn.toLowerCase();
      } else if (INHERIT_AGGS.has(fn)) {
        const innerName = tryAsColumnRef(agg.inner);
        type = innerName ? lookup(innerName) : null;
        role = "metric";
        aggType = fn.toLowerCase();
      } else {
        // 非集計の関数 (UPPER, COALESCE, ...)。alias があれば登録するが型は不明。
        if (aliasName) {
          out.push({ name: aliasName, role: null, type: null });
        }
        continue;
      }
      // 集計関数は通常 alias を要する。AS が無い場合は AlaSQL 出力名と合わせにくいのでスキップ。
      if (!aliasName) continue;
      const entry = { name: aliasName, role, type };
      if (aggType) entry.aggType = aggType;
      out.push(entry);
      continue;
    }

    // 単純カラム参照
    const refName = tryAsColumnRef(exprPart);
    if (refName) {
      const type = lookup(refName);
      const name = aliasName || refName;
      out.push({ name, role: "dimension", type: type || null });
      continue;
    }

    // 複合式 (a + b など)。AS があれば名前のみ登録、型は null（UI 側で degrade）。
    if (aliasName) {
      out.push({ name: aliasName, role: null, type: null });
    }
  }
  return out;
}
