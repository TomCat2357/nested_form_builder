/**
 * 計算式コンパイル・評価エンジン
 *
 * 計算フィールド (type: "calculated") の数式を安全に評価する。
 *
 * 使い方:
 *   const compiled = compileFormula("{売上} - {経費} * 0.1");
 *   // compiled.dependencies = ["売上", "経費"]
 *   const result = evaluateFormula(compiled, { "売上": "1000", "経費": "200" });
 *   // result = { value: 980, error: null }
 *
 * サポート:
 *   - 四則演算: + - * / % **
 *   - 関数: max, min, abs, round, floor, ceil, trunc, pow, sqrt, log, log10
 *   - 定数: PI, E
 *   - Math.xxx 形式もOK: Math.max(...) 等
 */

// ---------------------------------------------------------------------------
// Allowed math sandbox
// ---------------------------------------------------------------------------

const SAFE_MATH = {
  max: Math.max,
  min: Math.min,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  trunc: Math.trunc,
  pow: Math.pow,
  sqrt: Math.sqrt,
  log: Math.log,
  log10: Math.log10,
  PI: Math.PI,
  E: Math.E,
};

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

const TOKEN_RE = /\{([^{}]+)\}/g;

/**
 * 数式からフィールド参照トークンを抽出する
 * @param {string} formula
 * @returns {string[]} フィールドラベルの配列（重複なし）
 */
export const extractFormulaDependencies = (formula) => {
  if (!formula || typeof formula !== "string") return [];
  const deps = [];
  const seen = new Set();
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(formula)) !== null) {
    const label = m[1].trim();
    if (label && !seen.has(label)) {
      deps.push(label);
      seen.add(label);
    }
  }
  return deps;
};

// ---------------------------------------------------------------------------
// Security validation
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS = [
  /\b(eval|Function|setTimeout|setInterval)\b/,
  /\b(window|document|globalThis|self)\b/,
  /\b(import|require|export)\b/,
  /\b(this|__proto__|constructor|prototype)\b/,
  /=>/,
  /[^!=<>]=(?!=)/,       // assignment (but allow ==, !=, <=, >=)
  /\b(new|delete|typeof|void|in|instanceof)\b/,
  /\b(for|while|do|if|else|switch|case|break|continue|return|throw|try|catch|finally)\b/,
  /\b(var|let|const|class|function)\b/,
  /`/,                    // template literals
  /["']/,                // string literals
];

/**
 * トークン({...})を取り除いた残りの部分を検証する
 */
const validateFormula = (rawFormula) => {
  // トークンをプレースホルダーに置換してからバリデーション
  const stripped = rawFormula.replace(TOKEN_RE, " _REF_ ");
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(stripped)) {
      return { ok: false, error: `計算式に使用できないパターンが含まれています` };
    }
  }
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

const COMPILE_CACHE = new Map();
const CACHE_MAX_SIZE = 200;

/**
 * 計算式をコンパイルする
 * @param {string} formulaStr - 計算式文字列（例: "{売上} + {経費} * 3"）
 * @returns {{ fn: Function|null, dependencies: string[], error: string|null }}
 */
export const compileFormula = (formulaStr) => {
  if (!formulaStr || typeof formulaStr !== "string") {
    return { fn: null, dependencies: [], error: null };
  }

  const trimmed = formulaStr.trim();
  if (!trimmed) return { fn: null, dependencies: [], error: null };

  const cached = COMPILE_CACHE.get(trimmed);
  if (cached) return cached;

  const dependencies = extractFormulaDependencies(trimmed);

  // Validate the raw formula (before token replacement)
  const validation = validateFormula(trimmed);
  if (!validation.ok) {
    const result = { fn: null, dependencies, error: validation.error };
    cacheResult(trimmed, result);
    return result;
  }

  // Replace {fieldLabel} with __v["fieldLabel"]
  let expr = trimmed.replace(TOKEN_RE, (_match, label) => {
    return `__v[${JSON.stringify(label.trim())}]`;
  });

  // Replace Math.xxx with __m.xxx
  expr = expr.replace(/\bMath\.(\w+)/g, (_match, name) => `__m.${name}`);

  // Replace standalone function calls: max(...) -> __m.max(...)
  // Negative lookbehind to avoid double-replacing Math.xxx that already became __m.xxx
  const funcNames = Object.keys(SAFE_MATH).filter((k) => typeof SAFE_MATH[k] === "function");
  const funcPattern = new RegExp(`(?<!\\.)\\b(${funcNames.join("|")})\\s*\\(`, "g");
  expr = expr.replace(funcPattern, (_match, name) => `__m.${name}(`);

  // Replace standalone constants: PI -> __m.PI, E -> __m.E
  expr = expr.replace(/\bPI\b/g, "__m.PI");
  expr = expr.replace(/\bE\b(?!\w)/g, "__m.E");

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("__v", "__m", `"use strict"; return (${expr});`);
    const result = { fn, dependencies, error: null };
    cacheResult(trimmed, result);
    return result;
  } catch (e) {
    const result = { fn: null, dependencies, error: `計算式の構文エラー: ${e.message}` };
    cacheResult(trimmed, result);
    return result;
  }
};

const cacheResult = (key, value) => {
  if (COMPILE_CACHE.size >= CACHE_MAX_SIZE) {
    const firstKey = COMPILE_CACHE.keys().next().value;
    COMPILE_CACHE.delete(firstKey);
  }
  COMPILE_CACHE.set(key, value);
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * コンパイル済み数式を評価する
 * @param {{ fn: Function|null, dependencies: string[], error: string|null }} compiled
 * @param {Object} labelValueMap - { fieldLabel: currentValue }
 * @returns {{ value: any, error: string|null }}
 */
export const evaluateFormula = (compiled, labelValueMap) => {
  if (compiled.error) return { value: null, error: compiled.error };
  if (!compiled.fn) return { value: "", error: null };

  const map = labelValueMap || {};

  // Build numeric variable map
  const vars = {};
  for (const dep of compiled.dependencies) {
    const raw = map[dep];
    if (raw === undefined || raw === null || raw === "") {
      vars[dep] = 0;
    } else {
      const num = Number(raw);
      vars[dep] = Number.isFinite(num) ? num : 0;
    }
  }

  try {
    const result = compiled.fn(vars, SAFE_MATH);
    if (result === undefined || result === null) {
      return { value: "", error: null };
    }
    if (typeof result === "number") {
      if (!Number.isFinite(result)) {
        return { value: null, error: Number.isNaN(result) ? "計算結果が数値ではありません" : "ゼロ除算エラー" };
      }
      // Avoid floating point display issues
      return { value: parseFloat(result.toPrecision(15)), error: null };
    }
    return { value: result, error: null };
  } catch (e) {
    return { value: null, error: `計算エラー: ${e.message}` };
  }
};
