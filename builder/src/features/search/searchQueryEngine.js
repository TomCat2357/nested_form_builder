import { parseStringToSerial } from "../../utils/dateTime.js";
import { isChoiceMarkerValue } from "../../utils/responses.js";
import {
  toBooleanLike,
  isChoiceColumn,
  isBooleanSortColumn,
  isNumericColumn,
  isDateLikeColumn,
  normalizeSearchText,
  normalizeColumnName,
  isEntryIdColumnName,
  matchColumnName,
  buildSearchableCandidates,
  deriveChoiceLabels,
} from "./searchTableValues.js";

/**
 * 検索クエリをトークン化
 * 例: '氏名:"山田" and (年齢>=20 or 性別:男性)'
 */
const tokenizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') return [];

  const tokens = [];
  const normalizedQuery = query.replace(/==/g, "=");
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

    // 条件式のトークン化
    // パターン1: 列名:/正規表現/
    const regexMatch = remaining.match(/^([^\s:()]+):\/(.+?)\//);
    if (regexMatch) {
      const colName = regexMatch[1].trim().replace(/^["']|["']$/g, '');
      const pattern = regexMatch[2];
      tokens.push({ type: 'REGEX', column: colName, pattern });
      i += regexMatch[0].length;
      continue;
    }

    // パターン2: 列名[演算子]値（数値・等価比較用。":" "=" "==" 同義）
    // 引用符で囲まれた値はスペースを含めて全体を取得
    let operatorMatch = remaining.match(/^([^\s:()><=!]+)(>=|<=|<>|><|!=|>|<|=|:|==)"([^"]*)"(?=\s|$|[()])/i);
    if (!operatorMatch) {
      operatorMatch = remaining.match(/^([^\s:()><=!]+)(>=|<=|<>|><|!=|>|<|=|:|==)'([^']*)'(?=\s|$|[()])/i);
    }
    if (!operatorMatch) {
      operatorMatch = remaining.match(/^([^\s:()><=!]+)(>=|<=|<>|><|!=|>|<|=|:|==)(.+?)(?=\s|$|[()])/i);
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
        const trailing = normalizedQuery.slice(i + consumedLength);
        const timeSuffixMatch = trailing.match(/^\s+(\d{1,2}:\d{2}(?::\d{2})?)(?=\s|$|[()])/);
        if (timeSuffixMatch) {
          value = `${value} ${timeSuffixMatch[1]}`;
          consumedLength += timeSuffixMatch[0].length;
        }
      }
      if (value === "") {
        pushAlwaysFalse();
        i += consumedLength;
        continue;
      }
      const normalized = value.toLowerCase();
      const op = operator === ":" || operator === "==" ? "=" : operator;

      // 真偽指定（=のみ）
      if ((normalized === "true" || normalized === "false") && (op === "=")) {
        tokens.push({ type: 'COLUMN_BOOL', column: colName, value: normalized === "true" });
        i += consumedLength;
        continue;
      }

      // 数値比較か判定（= / > / < 等でも数値優先）
      const num = Number(value);
      const isNumeric = Number.isFinite(num);
      if (!isNumeric && op === "=") {
        // 文字列として扱う → COLUMN_PARTIAL（含有）に回す
        tokens.push({ type: 'COLUMN_PARTIAL', column: colName, keyword: value });
        i += consumedLength;
        continue;
      }

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
const parseTokens = (tokens) => {
  let pos = 0;

  const CONDITION_TYPES = new Set(['PARTIAL', 'COLUMN_PARTIAL', 'COMPARE', 'REGEX', 'COLUMN_BOOL', 'ALWAYS_FALSE']);
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

/**
 * 列名から対応するcolumnオブジェクトを取得
 */
const resolveColumnByNameForRow = (columns, colName, row) => {
  if (!columns || !colName) return { column: null, blockedByScope: false };

  const normalized = colName.trim().toLowerCase();

  for (const column of columns) {
    if (!matchColumnName(column, normalized)) continue;
    return { column, blockedByScope: false };
  }

  return { column: null, blockedByScope: false };
};

const findMatchingEntryField = (row, columnName) => {
  const entryData = row?.entry?.data || {};
  const entryDataUnixMs = row?.entry?.dataUnixMs || {};
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

  const matchingKey = Object.keys(entryData).find((key) => {
    const lower = normalizeColumnName(key);
    return lower === normalizedColName || lower.includes(normalizedColName);
  });

  if (!matchingKey) return null;

  return {
    key: matchingKey,
    value: entryData[matchingKey],
    unixMs: entryDataUnixMs[matchingKey],
  };
};

const candidateMatches = (field, predicate) => {
  if (!field) return false;
  return buildSearchableCandidates(field.key, field.value, field.unixMs).some(predicate);
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

  let normalizedOperator = operator;
  if (operator === ':' || operator === '==') normalizedOperator = '=';
  if (operator === '!=') normalizedOperator = '<>';
  if (operator === '><') normalizedOperator = '<>';

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
      if (lower === targetLower || lower.startsWith(`${targetLower}|`)) {
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
      const keyword = normalizeSearchText(ast.keyword);
      if (!keyword) return true;

      const matchesInColumns = (columns || []).some((column) => {
        if (column.searchable === false) return false;
        const text = row?.values?.[column.key]?.search;
        return Boolean(text && text.includes(keyword));
      });
      if (matchesInColumns) return true;

      const entryId = row?.entry?.id;
      if (entryId !== undefined && entryId !== null && entryId !== "") {
        const matchesEntryId = buildSearchableCandidates("id", entryId).some((candidate) => {
          if (!candidate) return false;
          return normalizeSearchText(candidate).includes(keyword);
        });
        if (matchesEntryId) return true;
      }

      const entryData = row?.entry?.data || {};
      const entryDataUnixMs = row?.entry?.dataUnixMs || {};
      return Object.entries(entryData).some(([key, value]) => {
        const unixMs = entryDataUnixMs[key];
        return buildSearchableCandidates(key, value, unixMs).some((candidate) => {
          if (!candidate) return false;
          return normalizeSearchText(candidate).includes(keyword);
        });
      });
    }

    case 'COLUMN_PARTIAL': {
      if (!ast.keyword) return false;
      const { column, blockedByScope } = resolveColumnByNameForRow(columns, ast.column, row);
      if (column) {
        const text = row?.values?.[column.key]?.search;
        return Boolean(text && text.includes(normalizeSearchText(ast.keyword)));
      }
      if (blockedByScope) return false;

      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return false;
      const keyword = normalizeSearchText(ast.keyword);
      return candidateMatches(entryField, (candidate) => {
        if (!candidate) return false;
        return normalizeSearchText(candidate).includes(keyword);
      });
    }

    case 'COLUMN_BOOL': {
      const { column, blockedByScope } = resolveColumnByNameForRow(columns, ast.column, row);
      if (!column && blockedByScope) return false;
      const boolValue = resolveBooleanValueForRow(row, column, ast.column);
      return boolValue === ast.value;
    }

    case 'COMPARE': {
      if (ast.value === "") return false;
      const { column, blockedByScope } = resolveColumnByNameForRow(columns, ast.column, row);
      if (column) {
        const cellValue = row?.values?.[column.key];
        const rowValue = cellValue?.sort ?? cellValue?.display ?? '';
        if (isDateLikeColumn(column)) {
          const rowMs = parseStringToSerial(String(rowValue));
          const targetMs = parseStringToSerial(String(ast.value));
          if (!Number.isFinite(rowMs) || !Number.isFinite(targetMs)) return false;
          return compareValue(rowMs, ast.operator, targetMs, { allowNumeric: true });
        }

        const numericPossible = Number.isFinite(Number(rowValue)) && Number.isFinite(Number(ast.value));
        const allowNumeric = isNumericColumn(column) || typeof rowValue === "number" || numericPossible;
        if (rowValue !== '') {
          return compareValue(rowValue, ast.operator, ast.value, { allowNumeric });
        }
      }
      if (blockedByScope) return false;

      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return false;
      return candidateMatches(entryField, (candidate) => {
        if (candidate === undefined || candidate === null || candidate === "") return false;
        const allowNumericCandidate = Number.isFinite(Number(candidate)) && Number.isFinite(Number(ast.value));
        return compareValue(candidate, ast.operator, ast.value, { allowNumeric: allowNumericCandidate });
      });
    }

    case 'REGEX': {
      if (!ast.pattern) return false;
      const { column, blockedByScope } = resolveColumnByNameForRow(columns, ast.column, row);
      try {
        const regex = new RegExp(ast.pattern, 'i');
        if (column) {
          const text = row?.values?.[column.key]?.display ?? '';
          return regex.test(text);
        }
        if (blockedByScope) return false;

        const entryField = findMatchingEntryField(row, ast.column);
        if (!entryField) return false;

        const candidates = buildSearchableCandidates(entryField.key, entryField.value, entryField.unixMs);
        if (candidates.length === 0) {
          return regex.test('');
        }
        return candidates.some((candidate) => regex.test(candidate ?? ''));
      } catch (error) {
        console.warn('Invalid regex pattern:', ast.pattern, error);
        return false;
      }
    }

    case 'ALWAYS_FALSE':
      return false;

    default:
      return true;
  }
};

const evaluateAstAcrossContext = (ast, parentRow, childRows, columns) => {
  if (!ast || ast.type === 'EMPTY') return true;

  switch (ast.type) {
    case 'NOT':
      return !evaluateAstAcrossContext(ast.value, parentRow, childRows, columns);
    case 'AND':
      return evaluateAstAcrossContext(ast.left, parentRow, childRows, columns)
        && evaluateAstAcrossContext(ast.right, parentRow, childRows, columns);
    case 'OR':
      return evaluateAstAcrossContext(ast.left, parentRow, childRows, columns)
        || evaluateAstAcrossContext(ast.right, parentRow, childRows, columns);
    default:
      if (evaluateLeafOnRow(ast, parentRow, columns)) return true;
      return (childRows || []).some((childRow) => evaluateLeafOnRow(ast, childRow, columns));
  }
};

const evaluateAstForSpecificChild = (ast, parentRow, childRow, columns) => {
  if (!ast || ast.type === 'EMPTY') {
    return { matched: true, childMatched: false };
  }

  switch (ast.type) {
    case 'NOT': {
      const inner = evaluateAstForSpecificChild(ast.value, parentRow, childRow, columns);
      return { matched: !inner.matched, childMatched: false };
    }
    case 'AND': {
      const left = evaluateAstForSpecificChild(ast.left, parentRow, childRow, columns);
      const right = evaluateAstForSpecificChild(ast.right, parentRow, childRow, columns);
      const matched = left.matched && right.matched;
      return { matched, childMatched: matched && (left.childMatched || right.childMatched) };
    }
    case 'OR': {
      const left = evaluateAstForSpecificChild(ast.left, parentRow, childRow, columns);
      const right = evaluateAstForSpecificChild(ast.right, parentRow, childRow, columns);
      const matched = left.matched || right.matched;
      return {
        matched,
        childMatched: (left.matched && left.childMatched) || (right.matched && right.childMatched),
      };
    }
    default: {
      const parentMatched = evaluateLeafOnRow(ast, parentRow, columns);
      const childMatched = evaluateLeafOnRow(ast, childRow, columns);
      return {
        matched: parentMatched || childMatched,
        childMatched,
      };
    }
  }
};

export const getKeywordMatchDetail = (row, columns, keyword, options = {}) => {
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
    return { matched: true };
  }

  const tokens = tokenizeSearchQuery(keyword);
  const ast = parseTokens(tokens);
  const parentResult = evaluateAstForSpecificChild(ast, row, null, columns);
  return { matched: parentResult.matched };
};

/**
 * 検索クエリに基づいて行をフィルタリング
 *
 * 検索パターン:
 * 1. {部分一致ワード} - 全テキスト列でOR検索
 * 2. {列名}:{部分一致ワード} - 指定列で部分一致検索
 * 3. {列名}[>|>=|=|<=|<|<>|><|!=]{値} - 指定列で比較演算
 * 4. {列名}:/{正規表現}/ - 指定列で正規表現検索
 * 5. 上記をAND/ORまたは空白(暗黙AND)で連結、()で優先順位制御可能
 *
 * 例:
 * - "山田" → 全列から"山田"を含む行
 * - "氏名:山田" → 氏名列から"山田"を含む行
 * - "年齢>=20" → 年齢が20以上の行
 * - "氏名:/^山/" → 氏名が"山"で始まる行
 * - "氏名:山田 and 年齢>=20" → 氏名に"山田"を含み、年齢が20以上
 * - "(氏名:山田 or 氏名:田中) and 年齢>=20" → (氏名に"山田"または"田中")かつ年齢が20以上
 */
export const matchesKeyword = (row, columns, keyword, options = {}) => {
  return getKeywordMatchDetail(row, columns, keyword, options).matched;
};
