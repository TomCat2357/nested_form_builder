// フォーム用 URL を組み立てる共通コア。?form=<fileId> を必ず付け、params の各キーは
// 値が空なら delete、非空なら set する。URL コンストラクタが使えない環境では文字列で組む。
const buildFormUrl_ = (baseUrl, formId, params) => {
  const normalizedBaseUrl = String(baseUrl || "").trim();
  const normalizedFormId = String(formId || "").trim();
  if (!normalizedBaseUrl || !normalizedFormId) return "";

  const entries = Object.entries(params).map(([key, value]) => [key, String(value || "").trim()]);

  try {
    const url = new URL(normalizedBaseUrl);
    url.searchParams.set("form", normalizedFormId);
    for (const [key, value] of entries) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    return url.toString();
  } catch (_) {
    const hashIndex = normalizedBaseUrl.indexOf("#");
    const baseWithoutHash = hashIndex >= 0 ? normalizedBaseUrl.slice(0, hashIndex) : normalizedBaseUrl;
    const hashSuffix = hashIndex >= 0 ? normalizedBaseUrl.slice(hashIndex) : "";
    const joiner = baseWithoutHash.includes("?") ? "&" : "?";
    const extraQuery = entries
      .filter(([, value]) => value)
      .map(([key, value]) => `&${key}=${encodeURIComponent(value)}`)
      .join("");
    return `${baseWithoutHash}${joiner}form=${encodeURIComponent(normalizedFormId)}${extraQuery}${hashSuffix}`;
  }
};

export const buildSharedFormUrl = (baseUrl, formId, recordId = "") => (
  buildFormUrl_(baseUrl, formId, { record: recordId })
);

export const buildSharedRecordUrl = (baseUrl, formId, recordId) => (
  buildSharedFormUrl(baseUrl, formId, recordId)
);

// 子フォームを開くための URL を組む。?form=<対象fileId>&pid=<親レコードID>。
// 親レコードに紐づく子フォーム（pid で行を絞り込み・新規行に刻印）を別タブで開く用途で、
// record は付けない。buildSharedFormUrl は record 用途で他所が使うためシグネチャを変えない。
export const buildChildFormUrl = (baseUrl, formId, pid = "") => (
  buildFormUrl_(baseUrl, formId, { record: "", pid })
);
