import { resolveFormRef, isAmbiguousBareTitle, formQualifiedName } from "./formIdentifierResolver.js";
import { resolveColumnRef } from "./columnIdentifierResolver.js";
import { maskWithPlaceholders } from "./sqlLiteralMask.js";

const DEFAULT_ALIAS = "data";

// 未解決フォーム参照のエラー文。バレ名が同名複数で曖昧なときはフォルダ込み指定を例示して促す。
function unresolvedFormError(rawRef, base, formIndex) {
  if (formIndex && isAmbiguousBareTitle(base, formIndex)) {
    const all = (formIndex.byTitleAll && formIndex.byTitleAll.get(String(base))) || [];
    const examples = all.slice(0, 3).map((f) => "[" + formQualifiedName(f) + "]").join(" / ");
    return "同名フォームが複数あります。フォルダ込みで指定してください（例: " + examples + "）: " + rawRef;
  }
  return "未定義のフォーム: " + rawRef;
}

function sanitizeId(formId) {
  return String(formId || "").replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * フォーム 1 つは AlaSQL 上に 2 種のテーブルを持つ：
 *   - "data" variant: スプレッドシート由来の原データ（option 真偽値列含む）
 *   - "view" variant: 検索結果一覧と同じ整形済みデータ（radio/checkbox は親列にラベル）
 *
 * canonicalDataAlias / canonicalViewAlias で alias 名を解決する。
 * canonicalFormAlias は後方互換のため canonicalDataAlias を返す（旧 form_<id> alias は
 * loadFormsIntoAlaSql 側で同じ rows を別名登録して維持する）。
 */
export function canonicalDataAlias(formId) {
  return "data_" + sanitizeId(formId);
}

export function canonicalViewAlias(formId) {
  return "view_" + sanitizeId(formId);
}

export function canonicalFormAlias(formId) {
  return canonicalDataAlias(formId);
}

/**
 * 旧 canonical alias 名 (form_<id>)。loadFormsIntoAlaSql で
 * data variant のテーブルを別名登録するためだけに使う。
 */
export function legacyFormAlias(formId) {
  return "form_" + sanitizeId(formId);
}

function canonicalAliasForVariant(formId, variant) {
  return variant === "view" ? canonicalViewAlias(formId) : canonicalDataAlias(formId);
}

/**
 * フォーム参照トークンに `:data` / `:view` の suffix が付いていれば剥がして返す。
 *   "苦情データ:view" → { base: "苦情データ", variant: "view" }
 *   "苦情データ"      → { base: "苦情データ", variant: null }
 * suffix 大小文字は問わず data/view のみ受け付ける。
 */
function splitVariantSuffix(ref) {
  if (typeof ref !== "string") return { base: ref, variant: null };
  const idx = ref.lastIndexOf(":");
  if (idx <= 0) return { base: ref, variant: null };
  const suffix = ref.slice(idx + 1).toLowerCase();
  if (suffix === "data" || suffix === "view") {
    return { base: ref.slice(0, idx), variant: suffix };
  }
  return { base: ref, variant: null };
}

export function preprocessSql(sql, opts) {
  const options = opts || {};
  const formIndex = options.formIndex;
  const getColumnIndex = options.getColumnIndex;
  const defaultFormId = options.defaultFormId || null;

  const errors = [];
  // alias → { formId, variant }
  const aliasToFormSource = new Map();
  // 後方互換: alias → formId のみ。referencedFormIds と既存呼び出しのため維持する。
  const aliasToFormId = new Map();
  // 参照されたソースの dedup 集合。Map<"formId|variant", {formId, variant}>。
  const referencedSourcesMap = new Map();
  const referencedFormIdsSet = new Set();

  function registerAlias(alias, formId, variant) {
    if (!alias) return;
    aliasToFormSource.set(alias, { formId, variant });
    aliasToFormId.set(alias, formId);
  }
  function recordReference(formId, variant) {
    referencedFormIdsSet.add(formId);
    const key = formId + "|" + variant;
    if (!referencedSourcesMap.has(key)) {
      referencedSourcesMap.set(key, { formId, variant });
    }
  }

  if (defaultFormId) {
    recordReference(defaultFormId, "data");
    const dataCanon = canonicalDataAlias(defaultFormId);
    const legacy = legacyFormAlias(defaultFormId);
    registerAlias(DEFAULT_ALIAS, defaultFormId, "data");
    registerAlias(dataCanon, defaultFormId, "data");
    registerAlias(legacy, defaultFormId, "data"); // 旧 form_<id> 直書きの後方互換
    registerAlias(canonicalViewAlias(defaultFormId), defaultFormId, "view");
  }

  const masked = maskWithPlaceholders(sql, {
    includeLineComment: true,
    includeBlockComment: true,
  });
  let work = masked.masked;

  // バッククォート識別子を [...] に正規化（リテラル / コメントは退避済みなので安全）
  work = work.replace(/`([^`]+)`/g, (_m, name) => "[" + name + "]");

  // Pass 1: FROM/JOIN [name]  または  FROM/JOIN <bareIdent>
  // alias は (1) AS が明示されている (2) 後続が SQL 予約語でない、のどちらかのときだけ採用する。
  // bracketed 形は `:data` / `:view` の variant suffix を解釈する。bare 形は suffix なし。
  const RESERVED_AFTER_FROM = /^(WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|NATURAL|ON|USING|FOR|INTO|AS|WITH)$/i;
  const fromJoinRegex = /\b(FROM|JOIN)\b\s+(?:\[([^\]]+)\]|([A-Za-z_][\w]*))(?:\s+(AS\s+)?([A-Za-z_][\w]*))?/gi;
  work = work.replace(fromJoinRegex, (match, kw, bracketed, bare, hasAs, aliasCandidate) => {
    const rawRef = bracketed != null ? bracketed : bare;
    let aliasName = null;
    if (aliasCandidate && (hasAs || !RESERVED_AFTER_FROM.test(aliasCandidate))) {
      aliasName = aliasCandidate;
    }
    const trailing = aliasCandidate && !aliasName ? " " + aliasCandidate : "";

    // 既に登録済み alias (data, data_<id>, view_<id>, form_<id>, または FROM 句のユーザー定義 AS) はそのまま
    if (aliasToFormSource.has(rawRef)) {
      const src = aliasToFormSource.get(rawRef);
      recordReference(src.formId, src.variant);
      if (aliasName) registerAlias(aliasName, src.formId, src.variant);
      return kw + " " + rawRef + (aliasName ? " AS " + aliasName : "") + trailing;
    }

    // bracketed 形は variant suffix を解釈
    const { base, variant: explicitVariant } = bracketed != null
      ? splitVariantSuffix(rawRef)
      : { base: rawRef, variant: null };

    const form = resolveFormRef(base, formIndex);
    if (!form) {
      errors.push(unresolvedFormError(rawRef, base, formIndex));
      return match;
    }
    const variant = explicitVariant || "data";
    recordReference(form.id, variant);
    const canon = canonicalAliasForVariant(form.id, variant);
    registerAlias(canon, form.id, variant);
    if (aliasName) registerAlias(aliasName, form.id, variant);
    const aliasPart = aliasName ? " AS " + aliasName : " AS " + canon;
    return kw + " " + canon + aliasPart + trailing;
  });

  // Pass 2: [A].[B] (修飾付き列参照: A はフォーム名/ID、:variant suffix も解釈)
  work = work.replace(/\[([^\]]+)\]\s*\.\s*\[([^\]]+)\]/g, (_m, fRef, cRef) => {
    // 既に登録済み alias ならそれを使う
    if (aliasToFormSource.has(fRef)) {
      const src = aliasToFormSource.get(fRef);
      const colIdx = getColumnIndex ? getColumnIndex(src.formId) : null;
      const resolvedCol = resolveColumnRef(cRef, colIdx);
      const canon = canonicalAliasForVariant(src.formId, src.variant);
      return canon + ".[" + resolvedCol + "]";
    }
    const { base, variant: explicitVariant } = splitVariantSuffix(fRef);
    const form = resolveFormRef(base, formIndex);
    if (!form) {
      errors.push(unresolvedFormError(fRef, base, formIndex));
      return "[" + fRef + "].[" + cRef + "]";
    }
    const variant = explicitVariant || "data";
    recordReference(form.id, variant);
    const canon = canonicalAliasForVariant(form.id, variant);
    registerAlias(canon, form.id, variant);
    const colIdx = getColumnIndex ? getColumnIndex(form.id) : null;
    const resolvedCol = resolveColumnRef(cRef, colIdx);
    return canon + ".[" + resolvedCol + "]";
  });

  // Pass 3: <alias>.[B] (SQL エイリアス修飾)
  work = work.replace(/(\b[A-Za-z_][\w]*)\s*\.\s*\[([^\]]+)\]/g, (_m, alias, cRef) => {
    const src = aliasToFormSource.get(alias);
    const fid = (src && src.formId) || aliasToFormId.get(alias) || defaultFormId;
    const colIdx = (fid && getColumnIndex) ? getColumnIndex(fid) : null;
    const resolvedCol = resolveColumnRef(cRef, colIdx);
    return alias + ".[" + resolvedCol + "]";
  });

  // Pass 4: 残りの [B] (修飾なし列参照 → デフォルトフォーム)
  work = work.replace(/\[([^\]]+)\]/g, (_m, cRef) => {
    const colIdx = (defaultFormId && getColumnIndex) ? getColumnIndex(defaultFormId) : null;
    const resolvedCol = resolveColumnRef(cRef, colIdx);
    return "[" + resolvedCol + "]";
  });

  const transformedSql = masked.unmask(work);
  return {
    ok: errors.length === 0,
    transformedSql,
    referencedFormIds: Array.from(referencedFormIdsSet),
    referencedSources: Array.from(referencedSourcesMap.values()),
    aliasToFormId,
    aliasToFormSource,
    errors,
  };
}
