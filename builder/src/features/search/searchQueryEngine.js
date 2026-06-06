import { splitFieldKey, splitEscaped, PATH_SEP } from "../../utils/pathCodec.js";
import { SQL_MODE_RE, normalizeFullWidthSearchOperators } from "./searchSyntaxPreprocessor.js";
import {
  canonicalSearchOperator,
  compileSearchRegex,
  findColumnByName,
} from "./searchQueryShared.js";
import {
  toBooleanLike,
  isChoiceColumn,
  isNumericColumn,
  isDateLikeColumn,
  normalizeColumnName,
  isEntryIdColumnName,
  matchColumnName,
  buildSearchableCandidates,
  buildEntryLogicalFields,
  splitMultiValue,
  collectMultiValueTokens,
  isEmptyCell,
} from "./searchTableValues.js";

// `in (...)` / `not in (...)` の値リストを引用符・バックスラッシュ・カンマ対応で分解。
// 共有 codec（splitEscaped, 区切り `,`）に委譲し、`in ('a,b', c)` も `in (a\,b, c)` も
// 同じく「a,b」「c」に分解する（クォート / バックスラッシュ両エスケープを受理）。
const parseInList = (raw) => {
  if (raw === undefined || raw === null) return [];
  return splitEscaped(String(raw), ",", true)
    .map((tok) => tok.trim())
    .filter((tok) => tok !== "");
};

/**
 * 検索クエリをトークン化
 * 例: '氏名:"山田" and (年齢>=20 or 性別:男性)'
 *
 * 簡易検索の alasql WHERE 翻訳器（searchSimpleTranslate.js）からも再利用する。
 * トークナイザ/パーサを共有することで、簡易検索のフィルタ（alasql）とヒット抜粋
 * ハイライト（このファイル）の構文解釈を完全に一致させる。
 */
export const tokenizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') return [];

  const tokens = [];
  // 簡易モードのみ全角記号オペレータを半角化（SQL モード SELECT はそのまま）。
  const base = SQL_MODE_RE.test(query) ? query : normalizeFullWidthSearchOperators(query);
  const normalizedQuery = base.replace(/==/g, "=");
  let i = 0;
  const len = normalizedQuery.length;

  const pushAlwaysFalse = () => {
    tokens.push({ type: 'ALWAYS_FALSE' });
  };

  while (i < len) {
    const char = normalizedQuery[i];

    // 空白をスキップ
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // 括弧
    if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'LPAREN' : 'RPAREN', value: char });
      i++;
      continue;
    }

    // NOT演算子（後続が空白または括弧のみ許容）
    const remainingForNot = normalizedQuery.slice(i);
    const notMatch = remainingForNot.match(/^(not)(?=[\s(])/i);
    if (notMatch) {
      tokens.push({ type: 'NOT', value: 'not' });
      i += notMatch[0].length;
      continue;
    }

    // AND/OR演算子
    const remaining = normalizedQuery.slice(i);
    if (/^(and|AND)\b/i.test(remaining)) {
      tokens.push({ type: 'AND', value: 'and' });
      i += 3;
      continue;
    }
    if (/^(or|OR)\b/i.test(remaining)) {
      tokens.push({ type: 'OR', value: 'or' });
      i += 2;
      continue;
    }

    // パターン0: 列名 [not] in (値1, 値2, ...)
    // 演算子マッチや単語マッチより先に評価し、`col not in (...)` を1トークンで捕捉する。
    const inMatch = remaining.match(/^([^\s:()><=!]+)\s+(not\s+)?in\s*\(([^)]*)\)/i);
    if (inMatch) {
      const colName = inMatch[1].trim().replace(/^["']|["']$/g, '');
      const negate = !!inMatch[2];
      const values = parseInList(inMatch[3]);
      if (values.length > 0) {
        tokens.push({ type: 'COLUMN_IN', column: colName, values, negate });
      } else {
        pushAlwaysFalse();
      }
      i += inMatch[0].length;
      continue;
    }

    // 条件式のトークン化
    // パターン2: 列名[演算子]値（数値・等価比較用。":" "=" "==" 同義）
    // 引用符で囲まれた値はスペースを含めて全体を取得
    let operatorMatch = remaining.match(/^([^\s:()><=!]+)(>=|<=|<>|><|!=|>|<|=|:|==)"([^"]*)"(?=\s|$|[()])/i);
    let valueIsQuotedString = !!operatorMatch;
    if (!operatorMatch) {
      operatorMatch = remaining.match(/^([^\s:()><=!]+)(>=|<=|<>|><|!=|>|<|=|:|==)'([^']*)'(?=\s|$|[()])/i);
      valueIsQuotedString = !!operatorMatch;
    }
    if (!operatorMatch) {
      operatorMatch = remaining.match(/^([^\s:()><=!]+)(>=|<=|<>|><|!=|>|<|=|:|==)(.+?)(?=\s|$|[()])/i);
      // 無引用マッチは valueIsQuotedString = false のまま
    }
    if (operatorMatch) {
      const colName = operatorMatch[1].trim().replace(/^["']|["']$/g, '');
      const operator = operatorMatch[2];
      let value = operatorMatch[3].trim().replace(/^["']|["']$/g, '');
      const rawToken = operatorMatch[0].trim();
      let consumedLength = operatorMatch[0].length;
      if (operator === ":" && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(rawToken)) {
        tokens.push({ type: 'PARTIAL', keyword: rawToken });
        i += consumedLength;
        continue;
      }
      if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value)) {
        // 日付リテラルは canonical 表示（日付=ハイフン、日付↔時刻=アンダースコア）に合わせて
        // 正規化する。日付列との素の文字列比較なので、ユーザーが `/` 区切りで入力しても `-` に寄せ、
        // 続く時刻は `_` で結合する（`2026/01/01 09:00` → `2026-01-01_09:00`）。
        value = value.replace(/\//g, "-");
        const trailing = normalizedQuery.slice(i + consumedLength);
        const timeSuffixMatch = trailing.match(/^\s+(\d{1,2}:\d{2}(?::\d{2})?)(?=\s|$|[()])/);
        if (timeSuffixMatch) {
          value = `${value}_${timeSuffixMatch[1]}`;
          consumedLength += timeSuffixMatch[0].length;
        }
      }
      if (value === "") {
        // 引用符付き空文字（field="" や field:""）は「空欄を表す指定」として扱う：
        //   =, :, == → COLUMN_EMPTY    （cell.display が空の行にヒット）
        //   <>, !=   → COLUMN_NOT_EMPTY（空でない行のみ）
        //   その他   → 意味不明なので従来通り ALWAYS_FALSE
        // 無引用の空（field= や field:）は従来通りタイポ扱いで ALWAYS_FALSE。
        if (valueIsQuotedString) {
          const op = operator === ":" || operator === "==" ? "=" : operator;
          if (op === "=") {
            tokens.push({ type: 'COLUMN_EMPTY', column: colName });
          } else if (op === "<>" || op === "!=") {
            tokens.push({ type: 'COLUMN_NOT_EMPTY', column: colName });
          } else {
            pushAlwaysFalse();
          }
        } else {
          pushAlwaysFalse();
        }
        i += consumedLength;
        continue;
      }
      const normalized = value.toLowerCase();
      // `:` は含有マッチ専用に COLUMN_PARTIAL を emit、`==` は `=` のエイリアス。
      // = / <> / != / > / < / >= / <= は COMPARE で評価。
      if (operator === ":") {
        if (normalized === "true" || normalized === "false") {
          tokens.push({ type: 'COLUMN_BOOL', column: colName, value: normalized === "true" });
        } else {
          tokens.push({ type: 'COLUMN_PARTIAL', column: colName, keyword: value });
        }
        i += consumedLength;
        continue;
      }
      const op = operator === "==" ? "=" : operator;

      // 真偽指定（=のみ）
      if ((normalized === "true" || normalized === "false") && (op === "=")) {
        tokens.push({ type: 'COLUMN_BOOL', column: colName, value: normalized === "true" });
        i += consumedLength;
        continue;
      }

      // = / <> / != は厳密一致系として COMPARE で評価する（multi-value セルは集合分解）。
      // 数値・順序比較（> < >= <=）も同じ COMPARE トークンで表現し、評価器で型判定する。
      tokens.push({ type: 'COMPARE', column: colName, operator: op, value });
      i += consumedLength;
      continue;
    }

    // パターン3: 列名:部分一致ワード
    const colonMatch = remaining.match(/^([^\s:()]+):(.*?)(?=\s|$|[()])/i);
    if (colonMatch) {
      const colName = colonMatch[1].trim().replace(/^["']|["']$/g, '');
      const keywordRaw = colonMatch[2].trim();
      const keyword = keywordRaw.replace(/^["']|["']$/g, '');
      if (!keyword) {
        pushAlwaysFalse();
        i += colonMatch[0].length;
        continue;
      }
      const normalized = keyword.toLowerCase();
      if (normalized === "true" || normalized === "false") {
        tokens.push({ type: 'COLUMN_BOOL', column: colName, value: normalized === "true" });
      } else {
        tokens.push({ type: 'COLUMN_PARTIAL', column: colName, keyword });
      }
      i += colonMatch[0].length;
      continue;
    }

    // パターン4: 部分一致ワード（列名なし）
    const wordMatch = remaining.match(/^([^()\s]+)/);
    if (wordMatch) {
      const keyword = wordMatch[1].trim().replace(/^["']|["']$/g, '');
      if (keyword) {
        tokens.push({ type: 'PARTIAL', keyword });
        i += wordMatch[0].length;
        continue;
      }
    }

    // マッチしない場合は1文字進む
    i++;
  }

  return tokens;
};

/**
 * トークン列をASTに変換（再帰下降パーサー）
 */
export const parseTokens = (tokens) => {
  let pos = 0;

  const CONDITION_TYPES = new Set([
    'PARTIAL',
    'COLUMN_PARTIAL',
    'COMPARE',
    'COLUMN_BOOL',
    'ALWAYS_FALSE',
    'COLUMN_EMPTY',
    'COLUMN_NOT_EMPTY',
    'COLUMN_IN',
  ]);
  const isFactorStartToken = (token) => {
    if (!token) return false;
    if (token.type === 'LPAREN' || token.type === 'NOT') return true;
    return CONDITION_TYPES.has(token.type);
  };

  const parseExpression = () => {
    let left = parseTerm();

    while (pos < tokens.length && tokens[pos].type === 'OR') {
      pos++; // 'OR'をスキップ
      const right = parseTerm();
      left = { type: 'OR', left, right };
    }

    return left;
  };

  const parseTerm = () => {
    let left = parseFactor();

    while (pos < tokens.length) {
      if (tokens[pos].type === 'AND') {
        pos++; // 'AND'をスキップ
      } else if (tokens[pos].type === 'OR' || tokens[pos].type === 'RPAREN') {
        break;
      } else if (!isFactorStartToken(tokens[pos])) {
        break;
      }
      // 演算子なしで条件が連続する場合は暗黙ANDとして扱う
      const right = parseFactor();
      left = { type: 'AND', left, right };
    }

    return left;
  };

  const parseFactor = () => {
    const token = tokens[pos];

    if (!token) {
      return { type: 'EMPTY' };
    }

    if (token.type === 'NOT') {
      pos++;
      const expr = parseFactor();
      return { type: 'NOT', value: expr };
    }

    // 括弧で囲まれた式
    if (token.type === 'LPAREN') {
      pos++; // '('をスキップ
      const expr = parseExpression();
      if (pos < tokens.length && tokens[pos].type === 'RPAREN') {
        pos++; // ')'をスキップ
      }
      return expr;
    }

    // 条件
    if (CONDITION_TYPES.has(token.type)) {
      pos++;
      return token;
    }

    return { type: 'EMPTY' };
  };

  if (tokens.length === 0) {
    return { type: 'EMPTY' };
  }

  return parseExpression();
};

const findMatchingEntryField = (row, columnName) => {
  const normalizedColName = normalizeColumnName(columnName);
  if (!normalizedColName) return null;

  if (isEntryIdColumnName(normalizedColName)) {
    const entryId = row?.entry?.id;
    if (entryId === undefined || entryId === null || entryId === "") return null;
    return {
      key: "id",
      value: entryId,
      unixMs: undefined,
    };
  }

  // 選択肢マーカーは親フィールドへ集約した論理フィールドで解決する（● 自体は対象外）。
  const matchingField = buildEntryLogicalFields(row?.entry).find((field) => {
    const lower = normalizeColumnName(field.key);
    return lower === normalizedColName || lower.includes(normalizedColName);
  });

  if (!matchingField) return null;

  return {
    key: matchingField.key,
    value: matchingField.value,
    unixMs: matchingField.unixMs,
  };
};

// 論理フィールド `{ key, value, unixMs }` から検索候補文字列群を得る共通ショートカット。
const candidatesOf = (field) => buildSearchableCandidates(field.key, field.value, field.unixMs);

const candidateMatches = (field, predicate) => {
  if (!field) return false;
  return candidatesOf(field).some(predicate);
};

// 複数値トークン集合に対する厳密一致（= / <>）評価。
// トークンが空でも一般式で正しく解決する: = → false（不一致）、<> → true（空 != 値）。
const matchEqualityOverTokens_ = (tokens, target, normalizedOp) => {
  const anyEqual = tokens.some((t) => String(t) === String(target));
  return normalizedOp === '=' ? anyEqual : !anyEqual;
};

// 複数値トークン集合に対する in / not in 評価。
// トークンが空でも一般式で正しく解決する: in → false、not in → true。
const matchInOverTokens_ = (tokens, targets, negate) => {
  const anyMatch = tokens.some((t) => targets.some((v) => String(t) === String(v)));
  return negate ? !anyMatch : anyMatch;
};

/**
 * 値の比較（数値/文字列/日時を適切に処理）
 */
const compareValue = (rowValue, operator, targetValue, { allowNumeric = true } = {}) => {
  // 値の正規化
  const normalizeValue = (val) => {
    if (val === null || val === undefined || val === '') return '';
    return String(val);
  };

  const normalizedOperator = canonicalSearchOperator(operator);

  const rowStr = normalizeValue(rowValue);
  const targetStr = normalizeValue(targetValue);

  // 両方が数値として解釈できる場合は数値比較
  const rowNum = parseFloat(rowStr);
  const targetNum = parseFloat(targetStr);
  const bothNumbers = !Number.isNaN(rowNum) && !Number.isNaN(targetNum);

  // 引用符で囲まれていない数値の場合は数値比較
  const isQuoted = /^["']/.test(targetValue);

  if (allowNumeric && normalizedOperator !== '=' && normalizedOperator !== '<>' && normalizedOperator !== '><') {
    if (!bothNumbers || isQuoted) {
      return false;
    }
  }

  const useNumeric = allowNumeric && bothNumbers && !isQuoted;
  const a = useNumeric ? rowNum : rowStr;
  const b = useNumeric ? targetNum : targetStr;

  switch (normalizedOperator) {
    case "=": return a === b;
    case "<>": return a !== b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "<": return a < b;
    case "<=": return a <= b;
    default: return false;
  }
};

const resolveBooleanValueForRow = (row, column, columnName) => {
  const collectFromEntry = (entryData, target) => {
    const targetLower = String(target || "").toLowerCase();
    let found = false;
    let truthy = false;
    Object.entries(entryData || {}).forEach(([key, value]) => {
      const lower = String(key).toLowerCase();
      if (lower === targetLower || lower.startsWith(`${targetLower}${PATH_SEP}`)) {
        found = true;
        if (toBooleanLike(value)) truthy = true;
      }
    });
    if (!found) return null;
    return truthy;
  };

  if (column) {
    const cellValue = row?.values?.[column.key];
    if (typeof cellValue?.boolean === "boolean") return cellValue.boolean;
    if (isChoiceColumn(column)) {
      if (cellValue?.sort === 1) return true;
      if (cellValue?.sort === 0) return false;
    }
    if (cellValue && Object.prototype.hasOwnProperty.call(cellValue, "display")) {
      return toBooleanLike(cellValue.display);
    }
  }

  const entryData = row?.entry?.data || {};
  const boolFromEntry = collectFromEntry(entryData, columnName);
  if (boolFromEntry !== null) return boolFromEntry;

  return false;
};

/**
 * ASTを評価して行がマッチするか判定
 */
const evaluateLeafOnRow = (ast, row, columns) => {
  if (!row) return false;

  switch (ast.type) {
    case 'PARTIAL': {
      if (!ast.keyword) return true;
      const regex = compileSearchRegex(ast.keyword);

      const matchesInColumns = (columns || []).some((column) => {
        if (column.searchable === false) return false;
        const text = row?.values?.[column.key]?.display;
        return Boolean(text && regex.test(text));
      });
      if (matchesInColumns) return true;

      const entryId = row?.entry?.id;
      if (entryId !== undefined && entryId !== null && entryId !== "") {
        const matchesEntryId = buildSearchableCandidates("id", entryId).some((candidate) => {
          if (!candidate) return false;
          return regex.test(candidate);
        });
        if (matchesEntryId) return true;
      }

      // 選択肢マーカーは親フィールドへ集約済みの論理フィールドで判定する（● 自体は対象外）。
      return buildEntryLogicalFields(row?.entry).some((field) =>
        candidatesOf(field).some((candidate) => {
          if (!candidate) return false;
          return regex.test(candidate);
        }));
    }

    case 'COLUMN_PARTIAL': {
      if (!ast.keyword) return false;
      const regex = compileSearchRegex(ast.keyword);
      const column = findColumnByName(columns, ast.column);
      if (column) {
        const text = row?.values?.[column.key]?.display;
        return Boolean(text && regex.test(text));
      }

      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return false;
      return candidateMatches(entryField, (candidate) => {
        if (!candidate) return false;
        return regex.test(candidate);
      });
    }

    case 'COLUMN_BOOL': {
      const column = findColumnByName(columns, ast.column);
      const boolValue = resolveBooleanValueForRow(row, column, ast.column);
      return boolValue === ast.value;
    }

    case 'COLUMN_EMPTY': {
      // 引用付き空文字 `field=""` / `field:""` の評価。
      // 簡易検索は cell.display 基準で「表示が空」を空欄とみなす（null/"" を区別しない）。
      const column = findColumnByName(columns, ast.column);
      if (column) {
        return isEmptyCell(row?.values?.[column.key]?.display);
      }
      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return true; // entry に key 自体が無ければ空とみなす
      return isEmptyCell(entryField.value);
    }

    case 'COLUMN_NOT_EMPTY': {
      const column = findColumnByName(columns, ast.column);
      if (column) {
        return !isEmptyCell(row?.values?.[column.key]?.display);
      }
      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return false;
      return !isEmptyCell(entryField.value);
    }

    case 'COMPARE': {
      if (ast.value === "") return false;
      const column = findColumnByName(columns, ast.column);
      const normalizedOp = canonicalSearchOperator(ast.operator);
      const isEqualityOp = normalizedOp === '=' || normalizedOp === '<>';

      if (column) {
        const cellValue = row?.values?.[column.key];
        const rowValue = cellValue?.sort ?? cellValue?.display ?? '';
        if (isDateLikeColumn(column)) {
          // 日付関連型は「表示文字列 vs リテラル」の単純な文字列比較のみ行う。
          // canonical 化・前方一致補正・時刻のゼロ埋めなどの自動整形はしない。
          // 型(精度)を揃えて比較したい場合は DATE()/TIME() 等を明示的に使う（SQL モード）。
          const rowStr = cellValue?.display ?? '';
          return compareValue(rowStr, ast.operator, ast.value, { allowNumeric: false });
        }

        const isNumCol = isNumericColumn(column);
        const targetValue = ast.value;

        // 厳密一致系 (= / <>) は multi-value セルを集合分解で評価する（空セルは = 不一致 / <> 一致）。
        // 数値列の場合は単一値として従来通り compareValue に委譲。
        if (isEqualityOp && !isNumCol) {
          const tokens = splitMultiValue(cellValue?.display ?? '');
          return matchEqualityOverTokens_(tokens, targetValue, normalizedOp);
        }

        const numericPossible = Number.isFinite(Number(rowValue)) && Number.isFinite(Number(ast.value));
        const allowNumeric = isNumCol || typeof rowValue === "number" || numericPossible;
        if (rowValue !== '') {
          return compareValue(rowValue, ast.operator, ast.value, { allowNumeric });
        }
        // 数値列で空セル: <> は空 != 値 で TRUE、= は FALSE。
        if (isEqualityOp) {
          return normalizedOp === '<>';
        }
      }

      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) {
        // 列がエントリにも無い場合: <> は「空 != 値」で TRUE、= は FALSE、その他は FALSE。
        return isEqualityOp && normalizedOp === '<>';
      }

      // 列未解決時のフォールバック: 複数値候補を集合分解して厳密一致系を評価する。
      if (isEqualityOp) {
        const tokens = collectMultiValueTokens(candidatesOf(entryField));
        return matchEqualityOverTokens_(tokens, ast.value, normalizedOp);
      }
      return candidateMatches(entryField, (candidate) => {
        if (isEmptyCell(candidate)) return false;
        const allowNumericCandidate = Number.isFinite(Number(candidate)) && Number.isFinite(Number(ast.value));
        return compareValue(candidate, ast.operator, ast.value, { allowNumeric: allowNumericCandidate });
      });
    }

    case 'COLUMN_IN': {
      const targets = Array.isArray(ast.values) ? ast.values : [];
      const negate = Boolean(ast.negate);
      if (targets.length === 0) return negate; // 空リスト: in→false, not in→true（恒真）
      const column = findColumnByName(columns, ast.column);

      // 空セル / トークン無しは matchInOverTokens_ が in→false・not in→true に解決する。
      if (column) {
        const tokens = splitMultiValue(row?.values?.[column.key]?.display ?? '');
        return matchInOverTokens_(tokens, targets, negate);
      }

      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return negate;
      const tokens = collectMultiValueTokens(candidatesOf(entryField));
      return matchInOverTokens_(tokens, targets, negate);
    }

    case 'ALWAYS_FALSE':
      return false;

    default:
      return true;
  }
};

const evaluateAst = (ast, row, columns) => {
  if (!ast || ast.type === 'EMPTY') return true;
  switch (ast.type) {
    case 'NOT': return !evaluateAst(ast.value, row, columns);
    case 'AND': return evaluateAst(ast.left, row, columns) && evaluateAst(ast.right, row, columns);
    case 'OR':  return evaluateAst(ast.left, row, columns) || evaluateAst(ast.right, row, columns);
    default:    return evaluateLeafOnRow(ast, row, columns);
  }
};

/**
 * 検索クエリに基づいて行をフィルタリング（簡易検索の意味論リファレンス）。
 *
 * ※ ライブの簡易検索フィルタは共通 alasql エンジンに統一済み
 *   （searchSimpleTranslate.js が WHERE 式へ翻訳 → filterRowsByExpr で評価）。
 *   この `matchesKeyword` はもうフィルタの本番経路では使われないが、簡易検索の意味論の
 *   リファレンス実装として残す（翻訳器のパリティテストのオラクル / evaluateLeafOnRow の
 *   直接的なテスト基盤）。evaluateLeafOnRow 自体はヒット抜粋ハイライト
 *   （buildRowHitExcerpts）で現役のため、本関数を消しても削減効果は小さい。
 *
 * 検索パターン:
 * 1. {正規表現ワード} - 全テキスト列を対象に正規表現検索
 * 2. {列名}:{正規表現ワード} - 指定列で正規表現検索
 * 3. {列名}[>|>=|=|<=|<|<>|><|!=]{値} - 指定列で比較演算
 * 4. 上記をAND/ORまたは空白(暗黙AND)で連結、()で優先順位制御可能
 *
 * 自由文（裸単語・`列名:値`）は正規表現として評価する（大小無視、不正な式はリテラル扱い）。
 * 旧構文 `列名:/正規表現/` は囲みスラッシュを剥がして同義に解釈する（後方互換）。
 *
 * 例:
 * - "山田" → 全列から"山田"に一致する行
 * - "氏名:山田" → 氏名列が正規表現"山田"に一致する行
 * - "年齢>=20" → 年齢が20以上の行
 * - "氏名:^山" → 氏名が"山"で始まる行
 * - "氏名:山田 and 年齢>=20" → 氏名が"山田"に一致し、年齢が20以上
 * - "(氏名:山田 or 氏名:田中) and 年齢>=20" → (氏名に"山田"または"田中")かつ年齢が20以上
 */
export const matchesKeyword = (row, columns, keyword) => {
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) return true;
  const tokens = tokenizeSearchQuery(keyword);
  const ast = parseTokens(tokens);
  return evaluateAst(ast, row, columns);
};

/**
 * クエリから自由文（PARTIAL / COLUMN_PARTIAL）のリーフを集めて
 * `[{ column: string|null, source }]` を返す。AND/OR/NOT 構造は無視した和集合。
 * column が null のものは全列対象。SQL モード（SELECT）は対象外で空配列。
 */
export const collectSearchPatterns = (keyword) => {
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) return [];
  if (SQL_MODE_RE.test(keyword.trim())) return [];
  const tokens = tokenizeSearchQuery(keyword);
  const patterns = [];
  tokens.forEach((token) => {
    if (token.type === 'PARTIAL') {
      patterns.push({ column: null, source: token.keyword });
    } else if (token.type === 'COLUMN_PARTIAL') {
      patterns.push({ column: token.column, source: token.keyword });
    }
  });
  return patterns;
};

// display テキストに regex を当て、ヒット語を中心に可視 budget 文字ぶんの窓を切り出して
// `{ text, hit }` セグメント配列にする。複数ヒットは窓内のものを全て太字対象に。
// budget は可視文字数の上限（両端の `…` は数えない）。長文の途中ヒットでも
// ヒット語を中央寄せにし、前後を均等配分して上限内に収める（Google スニペット風）。
const buildExcerptSegments_ = (text, regex, budget) => {
  const source = String(text ?? "");
  if (!source) return null;
  const matches = [];
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let m;
  let guard = 0;
  while ((m = re.exec(source)) !== null) {
    if (m[0] === "") {
      re.lastIndex += 1;
    } else {
      matches.push({ start: m.index, end: m.index + m[0].length });
    }
    if (++guard > 1000) break;
  }
  if (matches.length === 0) return null;

  const cap = Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : source.length;
  const first = matches[0];
  const last = matches[matches.length - 1];
  const matchSpan = last.end - first.start;

  let windowStart;
  let windowEnd;
  if (matchSpan >= cap) {
    // ヒット語自体が budget 以上 → ヒット先頭から budget 文字。
    windowStart = first.start;
    windowEnd = Math.min(source.length, first.start + cap);
  } else {
    // 残り予算を前後へ均等配分し、片側で余ったら反対側に回す。
    const remaining = cap - matchSpan;
    const half = Math.floor(remaining / 2);
    windowStart = Math.max(0, first.start - half);
    const usedLeft = first.start - windowStart;
    windowEnd = Math.min(source.length, last.end + (remaining - usedLeft));
    const usedRight = windowEnd - last.end;
    if (usedRight < remaining - usedLeft) {
      // 右端で使い切れなかった余りを左へ再配分。
      windowStart = Math.max(0, windowStart - (remaining - usedLeft - usedRight));
    }
  }

  const segments = [];
  if (windowStart > 0) segments.push({ text: "…", hit: false });
  let cursor = windowStart;
  matches.forEach(({ start, end }) => {
    if (end <= windowStart || start >= windowEnd) return;
    const s = Math.max(start, windowStart);
    const e = Math.min(end, windowEnd);
    if (s > cursor) segments.push({ text: source.slice(cursor, s), hit: false });
    segments.push({ text: source.slice(s, e), hit: true });
    cursor = e;
  });
  if (cursor < windowEnd) segments.push({ text: source.slice(cursor, windowEnd), hit: false });
  if (windowEnd < source.length) segments.push({ text: "…", hit: false });
  return segments;
};

// 与えられたパターン群から最初にヒットする抜粋セグメントを返す（無ければ null）。
const firstHitSegments_ = (text, patterns, budget) => {
  for (const p of patterns) {
    const regex = compileSearchRegex(p.source);
    const seg = buildExcerptSegments_(text, regex, budget);
    if (seg) return seg;
  }
  return null;
};

// 比較・IN・真偽などの列条件は「どの語に一致したか」が無いため、ヒット箇所には
// セル値全体を 1 ヒットセグメントとして示す。budget を超える長文は末尾を … で省略。
const wholeValueSegments_ = (text, budget) => {
  const source = String(text ?? "");
  if (!source) return null;
  if (!Number.isFinite(budget) || budget <= 0 || source.length <= budget) {
    return [{ text: source, hit: true }];
  }
  return [{ text: source.slice(0, budget), hit: true }, { text: "…", hit: false }];
};

// 列を指定する条件トークン（COMPARE / IN / BOOL / EMPTY / NOT_EMPTY）の型。
// PARTIAL 系（部分一致）とは別に、ヒット箇所表示で「条件が一致した列」を出すために使う。
const CONDITION_COLUMN_TYPES_ = new Set([
  'COMPARE',
  'COLUMN_IN',
  'COLUMN_BOOL',
  'COLUMN_EMPTY',
  'COLUMN_NOT_EMPTY',
]);

/**
 * クエリから列指定の条件トークン（COMPARE / COLUMN_IN / COLUMN_BOOL / COLUMN_EMPTY /
 * COLUMN_NOT_EMPTY）を集めて返す。AND/OR/NOT 構造は無視した和集合。
 * SQL モード（SELECT）は対象外で空配列。
 */
export const collectConditionColumns = (keyword) => {
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) return [];
  if (SQL_MODE_RE.test(keyword.trim())) return [];
  const tokens = tokenizeSearchQuery(keyword);
  return tokens.filter((token) => CONDITION_COLUMN_TYPES_.has(token.type) && token.column);
};

/**
 * 行のヒット列ごとに抜粋セグメントを作る（③ ヒット箇所表示モード用）。
 * 戻り値: `[{ columnKey, columnLabel, segments: [{ text, hit }] }]`
 * まず表示列（searchable !== false）の display を走査し、続いて表示列に出ていない
 * entry.data の非表示フィールドも走査する（evaluateLeafOnRow の data フォールバックと対応）。
 * 列指定パターンは対応列/キーのみ、列なしパターンは全件に適用。ヒットが無いものは含めない。
 * 抜粋長は budget（= cellDisplayLimit、未指定時は既定 40 字）で制御する。
 */
export const buildRowHitExcerpts = (row, columns, keyword, { cellDisplayLimit } = {}) => {
  const patterns = collectSearchPatterns(keyword);
  const conditions = collectConditionColumns(keyword);
  if (patterns.length === 0 && conditions.length === 0) return [];
  const budget = Number.isFinite(cellDisplayLimit) && cellDisplayLimit > 0 ? cellDisplayLimit : 40;
  const result = [];
  const coveredNames = new Set();

  // 1) 表示列
  (columns || []).forEach((column) => {
    if (!column || column.searchable === false) return;
    if (column.key === "__actions") return;
    if (column.path) coveredNames.add(normalizeColumnName(column.path));
    if (column.key) coveredNames.add(normalizeColumnName(column.key));
    const display = row?.values?.[column.key]?.display;
    if (!display) return;

    // 1a) 部分一致（PARTIAL / COLUMN_PARTIAL）: ヒット語を中心に抜粋。
    const applicablePatterns = patterns.filter((p) => {
      if (!p.column) return true;
      return matchColumnName(column, normalizeColumnName(p.column));
    });
    let segments = applicablePatterns.length > 0 ? firstHitSegments_(display, applicablePatterns, budget) : null;

    // 1b) 比較・IN・真偽などの列条件: 部分一致が無ければ、この列を指す条件が
    //     この行で成立するか評価し、成立すればセル値全体をヒットとして示す。
    //     `[column]` を渡して評価対象をこの列に限定し、同名別列での誤判定を防ぐ。
    if (!segments && conditions.length > 0) {
      const applicableConditions = conditions.filter((c) => matchColumnName(column, normalizeColumnName(c.column)));
      if (applicableConditions.some((token) => evaluateLeafOnRow(token, row, [column]))) {
        segments = wholeValueSegments_(display, budget);
      }
    }

    if (!segments) return;

    const columnLabel = Array.isArray(column.segments) && column.segments.length
      ? column.segments.join(" / ")
      : String(column.key ?? "");
    result.push({ columnKey: column.key, columnLabel, segments });
  });

  // 1.5) entry.id（ID 列が columns に無い場合の保険）。matchesKeyword の PARTIAL は
  // 表示列に依らず常に entry.id を照合するため、抜粋側もパリティを取り「(他の項目に一致)」を防ぐ。
  // ID 列が表示列にあれば coveredNames に "id" が入っているのでスキップ（重複防止）。
  if (!coveredNames.has("id")) {
    const entryId = row?.entry?.id;
    if (entryId !== undefined && entryId !== null && entryId !== "") {
      const applicable = patterns.filter((p) => {
        if (!p.column) return true;
        return normalizeColumnName(p.column) === "id";
      });
      if (applicable.length > 0) {
        let segments = null;
        for (const candidate of buildSearchableCandidates("id", entryId)) {
          if (!candidate) continue;
          segments = firstHitSegments_(candidate, applicable, budget);
          if (segments) break;
        }
        if (segments) {
          coveredNames.add("id");
          result.push({ columnKey: "id", columnLabel: "ID", segments });
        }
      }
    }
  }

  // 2) 表示列に出ていない entry.data フィールド
  // 選択肢マーカーは親フィールドへ集約した論理フィールドで走査する。集約後 key は親パスのため、
  // 親が表示列なら coveredNames で弾かれ「店舗 / 福岡支店：福岡支店」のような重複は出ない。
  buildEntryLogicalFields(row?.entry).forEach((field) => {
    const normalizedKey = normalizeColumnName(field.key);
    if (!normalizedKey || coveredNames.has(normalizedKey)) return;

    const fieldNameMatches = (name) => {
      const target = normalizeColumnName(name);
      return normalizedKey === target || normalizedKey.includes(target);
    };

    // マッチ判定（buildSearchableCandidates）と同じ候補群を抜粋ソースにする。
    const candidates = candidatesOf(field);

    // 2a) 部分一致（PARTIAL / COLUMN_PARTIAL）
    const applicable = patterns.filter((p) => !p.column || fieldNameMatches(p.column));
    let segments = null;
    if (applicable.length > 0) {
      for (const candidate of candidates) {
        if (!candidate) continue;
        segments = firstHitSegments_(candidate, applicable, budget);
        if (segments) break;
      }
    }

    // 2b) この非表示フィールドを指す列条件が成立すれば、フィールド値全体を示す。
    //     `[]` を渡して列解決を外し、評価器の entry フォールバック経路で判定させる。
    if (!segments && conditions.length > 0) {
      const applicableConditions = conditions.filter((c) => fieldNameMatches(c.column));
      if (applicableConditions.some((token) => evaluateLeafOnRow(token, row, []))) {
        const text = candidates.find((candidate) => candidate);
        if (text) segments = wholeValueSegments_(text, budget);
      }
    }

    if (!segments) return;

    coveredNames.add(normalizedKey);
    const columnLabel = splitFieldKey(String(field.key)).join(" / ");
    result.push({ columnKey: `data:${field.key}`, columnLabel, segments });
  });

  return result;
};
