/**
 * SQL 文字列のリテラル / コメント / 引用識別子をマスクする共通ユーティリティ。
 *
 * 3 種類の用途を 1 つのスキャナ + 2 種類の materializer に統一する:
 *
 *   1. sqlPreprocessor.preprocessSql
 *        - 用途: AlaSQL 用 SQL の literal / コメント を退避してから FROM 句や [col] を
 *          書き換え、最後に復元する。
 *        - 必要: 復元可能なプレースホルダ。長さ保存は不要。
 *        - 対象: 単一引用符 / 行コメント / ブロックコメント
 *
 *   2. sqlMaskScanner.maskTokens
 *        - 用途: 後続の文字列スキャナ（SELECT / FROM / カンマ / AS 探索）が
 *          literal や [...] / `...` 内のキーワード・カンマを誤マッチしないよう、
 *          内部を空白で覆って *オフセットを保存* する。
 *        - 必要: マスク後の文字列で元 sql の位置を slice できること。
 *        - 対象: 単一引用符 (\\' エスケープ可) / [...] / `...`
 *
 *   3. preprocessAlaSqlExpression
 *        - 用途: 式中の `ident` / [ident] の `|` を `__` に書き換える際、文字列リテラル
 *          内の `|` を守るための退避。
 *        - 必要: 復元可能なプレースホルダ。
 *        - 対象: 単一引用符 / 二重引用符
 *
 * 統一前は 3 箇所がそれぞれ独自のスキャンループを持ち、placeholder 形式も
 * `L<n>`（識別子と衝突する可能性あり）と空白埋めが混在していた。
 * 統一後は `scanMaskRegions` を共通スキャナとし、placeholder 版は SOH (U+0001) で
 * 囲んだ `\u0001<n>\u0001` 形式を使う（SQL の識別子・演算子・空白に出現しない sentinel）。
 */

export const KIND_SINGLE_QUOTE = "single-quote";
export const KIND_DOUBLE_QUOTE = "double-quote";
export const KIND_BRACKET = "bracket";
export const KIND_BACKTICK = "backtick";
export const KIND_LINE_COMMENT = "line-comment";
export const KIND_BLOCK_COMMENT = "block-comment";

// SOH (Start Of Heading, U+0001) を sentinel として使う。SQL の識別子・予約語・演算子・
// 空白文字いずれにも出現しない制御文字なので、placeholder トークンが SQL の他の部分と
// 衝突するリスクがほぼゼロになる。
const SENTINEL = "\u0001";
const PLACEHOLDER_RE = /\u0001(\d+)\u0001/g;

function findRegionEnd(sql, n, start, kind, opts) {
  switch (kind) {
    case KIND_SINGLE_QUOTE: {
      let j = start + 1;
      while (j < n) {
        const c = sql.charAt(j);
        if (c === "'" && sql.charAt(j + 1) === "'") { j += 2; continue; }
        if (opts.singleQuoteAllowsBackslash && c === "\\" && j + 1 < n) { j += 2; continue; }
        if (c === "'") { j++; break; }
        j++;
      }
      return j;
    }
    case KIND_DOUBLE_QUOTE: {
      let j = start + 1;
      while (j < n) {
        const c = sql.charAt(j);
        if (c === '"' && sql.charAt(j + 1) === '"') { j += 2; continue; }
        if (c === '"') { j++; break; }
        j++;
      }
      return j;
    }
    case KIND_BRACKET: {
      let j = start + 1;
      while (j < n && sql.charAt(j) !== "]") j++;
      if (j < n) j++;
      return j;
    }
    case KIND_BACKTICK: {
      let j = start + 1;
      while (j < n && sql.charAt(j) !== "`") j++;
      if (j < n) j++;
      return j;
    }
    case KIND_LINE_COMMENT: {
      let j = start;
      while (j < n && sql.charAt(j) !== "\n") j++;
      return j;
    }
    case KIND_BLOCK_COMMENT: {
      let j = start + 2;
      while (j < n - 1 && !(sql.charAt(j) === "*" && sql.charAt(j + 1) === "/")) j++;
      return Math.min(j + 2, n);
    }
  }
  return start + 1;
}

/**
 * SQL 文字列を 1 パスでスキャンし、指定された種類のマスク対象領域を
 * `[{ start, end, kind }]` の配列で返す（start..end は半開区間）。
 *
 * opts:
 *   includeSingleQuote (default true) — `'...'` を対象に含める
 *   singleQuoteAllowsBackslash       — `'a\\'b'` のような \\' エスケープを許容
 *   includeDoubleQuote               — `"..."` を対象に含める
 *   includeBracket                   — `[...]` を対象に含める
 *   includeBacktick                  — `` `...` `` を対象に含める
 *   includeLineComment               — `-- ...` を対象に含める
 *   includeBlockComment              — `/ * ... * /` を対象に含める
 */
export function scanMaskRegions(sql, opts) {
  const o = opts || {};
  const includeSingleQuote = o.includeSingleQuote !== false;
  const out = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql.charAt(i);
    let kind = null;
    if (includeSingleQuote && c === "'") kind = KIND_SINGLE_QUOTE;
    else if (o.includeDoubleQuote && c === '"') kind = KIND_DOUBLE_QUOTE;
    else if (o.includeBracket && c === "[") kind = KIND_BRACKET;
    else if (o.includeBacktick && c === "`") kind = KIND_BACKTICK;
    else if (o.includeLineComment && c === "-" && sql.charAt(i + 1) === "-") kind = KIND_LINE_COMMENT;
    else if (o.includeBlockComment && c === "/" && sql.charAt(i + 1) === "*") kind = KIND_BLOCK_COMMENT;

    if (kind) {
      const end = findRegionEnd(sql, n, i, kind, o);
      out.push({ start: i, end, kind });
      i = end;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * マスク対象領域を `\u0001<n>\u0001` 形式の placeholder で置換した文字列を返す。
 *
 *   { masked, placeholders, unmask(text) }
 *
 *   masked:       placeholder 置換後の SQL
 *   placeholders: 元の領域文字列の配列（添字 = placeholder の番号）
 *   unmask(text): masked 上の任意の派生文字列で placeholder を復元する関数
 *
 * 復元正規表現は SOH に囲まれた数字列を拾うので、書き換え後の文字列に対しても
 * 安全に呼び出せる（SQL 識別子・演算子と衝突しない）。
 */
export function maskWithPlaceholders(sql, opts) {
  const src = sql == null ? "" : String(sql);
  const regions = scanMaskRegions(src, opts || {});
  const placeholders = [];
  let out = "";
  let cursor = 0;
  for (const r of regions) {
    out += src.substring(cursor, r.start);
    out += SENTINEL + placeholders.length + SENTINEL;
    placeholders.push(src.substring(r.start, r.end));
    cursor = r.end;
  }
  out += src.substring(cursor);
  return {
    masked: out,
    placeholders,
    unmask(text) {
      return String(text).replace(PLACEHOLDER_RE, (_m, idx) => placeholders[Number(idx)]);
    },
  };
}

/**
 * マスク対象領域を「同じ長さの空白」で覆った文字列を返す（オフセット保存）。
 * 引用識別子 (`[...]` / `` `...` ``) は開閉文字を残して内部だけを空白化する
 * （後続スキャナが識別子の境界をまだ認識できるようにするため）。
 *
 * 用途: 後段の文字列スキャナ（findSelectFromRange / splitSelectColumns /
 * splitExprAndAlias / isWhollyWrappedByParens）が元 SQL の位置を slice するために
 * 同じ長さの覆い文字列が必要。
 */
export function maskWithSpaces(sql, opts) {
  const src = sql == null ? "" : String(sql);
  const regions = scanMaskRegions(src, opts || {});
  let out = "";
  let cursor = 0;
  for (const r of regions) {
    out += src.substring(cursor, r.start);
    const len = r.end - r.start;
    if (r.kind === KIND_BRACKET || r.kind === KIND_BACKTICK) {
      if (len >= 2) {
        const open = src.charAt(r.start);
        // 既存挙動互換: unclosed (`[abc` のような) ケースでも末尾に閉じ文字を出す。
        // 後段の括弧深度カウントが破綻しないよう、識別子境界を保つため。
        const closeChar = r.kind === KIND_BRACKET ? "]" : "`";
        out += open + " ".repeat(len - 2) + closeChar;
      } else {
        out += src.substring(r.start, r.end);
      }
    } else {
      out += " ".repeat(len);
    }
    cursor = r.end;
  }
  out += src.substring(cursor);
  return out;
}
