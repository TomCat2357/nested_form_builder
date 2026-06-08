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

// 参照スコープ外フォームのエラー文。置換 full-query（自フォームのみ可）で他フォーム参照したとき。
function outOfScopeFormError(rawRef) {
  return "このフォーム外のデータは参照できません（自フォーム _form のみ）。子フォームの件数・名前・URL は CHILD_FORM_COUNT / CHILD_FORM_NAME / CHILD_FORM_URL をご利用ください: " + rawRef;
}

function sanitizeId(formId) {
  return String(formId || "").replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * データ形式は view 形式に一本化された。1 フォーム = AlaSQL 上の 1 テーブル。
 * canonical alias は "data_<id>"。既定（defaultFormId）の bare alias "data" と
 * 旧 "form_<id>"（legacyFormAlias）は同じ rows を指す別名として登録する。
 * 旧 `:data` / `:view` の variant suffix は廃止：`[フォーム名:view]` は
 * 「:view 付きの未定義フォーム名」として解決エラーになる。
 */
export function canonicalDataAlias(formId) {
  return "data_" + sanitizeId(formId);
}

export function canonicalFormAlias(formId) {
  return canonicalDataAlias(formId);
}

/**
 * 旧 canonical alias 名 (form_<id>)。loadFormsIntoAlaSql で
 * 同一テーブルを別名登録するためだけに使う（後方互換）。
 */
export function legacyFormAlias(formId) {
  return "form_" + sanitizeId(formId);
}

export function preprocessSql(sql, opts) {
  const options = opts || {};
  const formIndex = options.formIndex;
  const getColumnIndex = options.getColumnIndex;
  const defaultFormId = options.defaultFormId || null;
  // 参照を許可するフォーム id 集合（Set）。未指定（null）なら全フォーム許可（検索 / Question /
  // Dashboard は従来どおり）。置換 full-query は { defaultFormId } のみを渡してスコープを絞る。
  const allowedFormIds = options.allowedFormIds instanceof Set ? options.allowedFormIds : null;

  const errors = [];
  // alias → formId
  const aliasToFormId = new Map();
  const referencedFormIdsSet = new Set();

  function registerAlias(alias, formId) {
    if (!alias) return;
    aliasToFormId.set(alias, formId);
  }
  function recordReference(formId) {
    referencedFormIdsSet.add(formId);
  }

  if (defaultFormId) {
    recordReference(defaultFormId);
    registerAlias(DEFAULT_ALIAS, defaultFormId);
    registerAlias(canonicalDataAlias(defaultFormId), defaultFormId);
    registerAlias(legacyFormAlias(defaultFormId), defaultFormId); // 旧 form_<id> 直書きの後方互換
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
  const RESERVED_AFTER_FROM = /^(WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|NATURAL|ON|USING|FOR|INTO|AS|WITH)$/i;
  const fromJoinRegex = /\b(FROM|JOIN)\b\s+(?:\[([^\]]+)\]|([A-Za-z_][\w]*))(?:\s+(AS\s+)?([A-Za-z_][\w]*))?/gi;
  work = work.replace(fromJoinRegex, (match, kw, bracketed, bare, hasAs, aliasCandidate) => {
    const rawRef = bracketed != null ? bracketed : bare;
    let aliasName = null;
    if (aliasCandidate && (hasAs || !RESERVED_AFTER_FROM.test(aliasCandidate))) {
      aliasName = aliasCandidate;
    }
    const trailing = aliasCandidate && !aliasName ? " " + aliasCandidate : "";

    // 検索 / Question SQL / テンプレート full-query モードの「現フォーム」別名 "_form"。
    // defaultFormId（=対象フォーム）に解決する。canonical テーブルを `AS _form` で貼り、
    // _form.[col] 修飾参照（Pass 3）も使えるよう "_form" alias を登録する。
    // （旧 "_" は廃止。後方互換なし。）
    if (rawRef === "_form") {
      if (!defaultFormId) {
        errors.push("対象フォーム未指定では FROM _form を使えません");
        return match;
      }
      recordReference(defaultFormId);
      const canon = canonicalDataAlias(defaultFormId);
      registerAlias(canon, defaultFormId);
      registerAlias("_form", defaultFormId);
      if (aliasName) registerAlias(aliasName, defaultFormId);
      const aliasPart = aliasName ? " AS " + aliasName : " AS _form";
      return kw + " " + canon + aliasPart + trailing;
    }

    // 既に登録済み alias (data, data_<id>, form_<id>, または FROM 句のユーザー定義 AS) はそのまま
    if (aliasToFormId.has(rawRef)) {
      const fid = aliasToFormId.get(rawRef);
      recordReference(fid);
      if (aliasName) registerAlias(aliasName, fid);
      return kw + " " + rawRef + (aliasName ? " AS " + aliasName : "") + trailing;
    }

    const form = resolveFormRef(rawRef, formIndex);
    if (!form) {
      errors.push(unresolvedFormError(rawRef, rawRef, formIndex));
      return match;
    }
    if (allowedFormIds && !allowedFormIds.has(form.id)) {
      errors.push(outOfScopeFormError(rawRef));
      return match;
    }
    recordReference(form.id);
    const canon = canonicalDataAlias(form.id);
    registerAlias(canon, form.id);
    if (aliasName) registerAlias(aliasName, form.id);
    const aliasPart = aliasName ? " AS " + aliasName : " AS " + canon;
    return kw + " " + canon + aliasPart + trailing;
  });

  // Pass 2: [A].[B] (修飾付き列参照: A はフォーム名/ID)
  work = work.replace(/\[([^\]]+)\]\s*\.\s*\[([^\]]+)\]/g, (_m, fRef, cRef) => {
    // 現フォーム別名 [_form].[col]: Pass 1 で canon AS _form を貼っているので _form alias で参照する。
    if (fRef === "_form" && defaultFormId) {
      const colIdx = getColumnIndex ? getColumnIndex(defaultFormId) : null;
      return "_form.[" + resolveColumnRef(cRef, colIdx) + "]";
    }
    // 既に登録済み alias ならそれを使う
    if (aliasToFormId.has(fRef)) {
      const fid = aliasToFormId.get(fRef);
      const colIdx = getColumnIndex ? getColumnIndex(fid) : null;
      const resolvedCol = resolveColumnRef(cRef, colIdx);
      const canon = canonicalDataAlias(fid);
      return canon + ".[" + resolvedCol + "]";
    }
    const form = resolveFormRef(fRef, formIndex);
    if (!form) {
      errors.push(unresolvedFormError(fRef, fRef, formIndex));
      return "[" + fRef + "].[" + cRef + "]";
    }
    if (allowedFormIds && !allowedFormIds.has(form.id)) {
      errors.push(outOfScopeFormError(fRef));
      return "[" + fRef + "].[" + cRef + "]";
    }
    recordReference(form.id);
    const canon = canonicalDataAlias(form.id);
    registerAlias(canon, form.id);
    const colIdx = getColumnIndex ? getColumnIndex(form.id) : null;
    const resolvedCol = resolveColumnRef(cRef, colIdx);
    return canon + ".[" + resolvedCol + "]";
  });

  // Pass 3: <alias>.[B] (SQL エイリアス修飾)
  work = work.replace(/(\b[A-Za-z_][\w]*)\s*\.\s*\[([^\]]+)\]/g, (_m, alias, cRef) => {
    const fid = aliasToFormId.get(alias) || defaultFormId;
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
    aliasToFormId,
    errors,
  };
}
