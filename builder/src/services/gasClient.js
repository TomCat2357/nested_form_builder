import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";

export const hasScriptRun = () =>
  typeof google !== "undefined" &&
  google?.script?.run;

const normalizeScriptRunError = (err) => {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (err && typeof err.message === "string") return new Error(err.message);
  try {
    return new Error(JSON.stringify(err) || "Apps Script call failed");
  } catch (jsonErr) {
    return new Error("Apps Script call failed");
  }
};

const handleFetchError = (res, json) => {
  console.error('[gasClient] Fetch Error:', {
    status: res.status,
    statusText: res.statusText,
    type: res.type,
    ok: res.ok,
    url: res.url,
    headers: Object.fromEntries(res.headers.entries()),
    json
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("GAS WebApp へのアクセスが許可されていません。デプロイの公開範囲が『全員』になっているか確認してください。");
  }
  if (res.type === "opaqueredirect") {
    throw new Error("GAS WebApp がリダイレクトを返しました。アクセス権限またはURLを確認してください。");
  }
  throw new Error(json?.error || `${res.status} ${res.statusText}`);
};

const callScriptRun = (functionName, payload) =>
  new Promise((resolve, reject) => {
    if (!hasScriptRun()) {
      reject(new Error("google.script.run is not available"));
      return;
    }
    google.script.run
      .withSuccessHandler((result) => resolve(result))
      .withFailureHandler((error) => reject(normalizeScriptRunError(error)))[functionName](payload);
  });

export const loadUserSettings = async () => {
  if (!hasScriptRun()) return null;
  try {
    const result = await callScriptRun("nfbLoadUserSettings");
    if (result && typeof result === "object") return result;
    return null;
  } catch (error) {
    console.warn("[gasClient] loadUserSettings failed", error);
    return null;
  }
};

export const saveUserSettings = async (settings) => {
  if (!hasScriptRun()) return null;
  try {
    const result = await callScriptRun("nfbSaveUserSettings", settings || {});
    return result && typeof result === "object" ? result : null;
  } catch (error) {
    console.warn("[gasClient] saveUserSettings failed", error);
    return null;
  }
};

export const submitResponses = async ({ gasUrl, spreadsheetId, sheetName = "Responses", payload }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  const body = { ...(payload || {}), spreadsheetId, sheetName };

  if (hasScriptRun()) {
    const result = await callScriptRun("saveResponses", body);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Apps Script call failed");
    }
    return result;
  }

  if (!gasUrl) throw new Error("GAS URL is required");

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json;
};

export const deleteEntry = async ({ gasUrl, spreadsheetId, sheetName = "Responses", entryId }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!entryId) throw new Error("entryId is required");

  const cleanSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  const payload = {
    spreadsheetId: cleanSpreadsheetId,
    sheetName,
    id: entryId,
  };

  if (hasScriptRun()) {
    const result = await callScriptRun("deleteRecord", payload);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Delete failed");
    }
    return result;
  }

  if (!gasUrl) throw new Error("GAS URL is required when not in google.script.run environment");

  const body = { action: "delete", ...payload };
  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json;
};

export const getEntry = async ({ gasUrl, spreadsheetId, sheetName = "Responses", entryId }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!entryId) throw new Error("entryId is required");

  const cleanSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  const payload = {
    spreadsheetId: cleanSpreadsheetId,
    sheetName,
    id: entryId,
  };

  if (hasScriptRun()) {
    const result = await callScriptRun("getRecord", payload);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Get record failed");
    }
    return result.record || null;
  }

  if (!gasUrl) throw new Error("GAS URL is required when not in google.script.run environment");

  const body = { action: "get", ...payload };
  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json.record || null;
};

export const listEntries = async ({ gasUrl, spreadsheetId, sheetName = "Responses" }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  const cleanSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  const payload = {
    spreadsheetId: cleanSpreadsheetId,
    sheetName,
  };

  if (hasScriptRun()) {
    const result = await callScriptRun("listRecords", payload);
    if (!result || result.ok === false) {
      console.error("[gasClient] Result validation failed - result:", result);
      throw new Error(result?.error || "List failed");
    }
    return {
      records: result.records || [],
      headerMatrix: result.headerMatrix || []
    };
  }

  if (!gasUrl) throw new Error("GAS URL is required when not in google.script.run environment");

  const body = { action: "list", ...payload };
  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return {
    records: json.records || [],
    headerMatrix: json.headerMatrix || []
  };
};

// ========================================
// フォーム管理API
// ========================================

/**
 * フォーム一覧を取得
 * @param {Object} options - オプション
 * @param {string} options.gasUrl - GAS WebApp URL
 * @param {boolean} options.includeArchived - アーカイブ済みを含めるか
 * @returns {Promise<Array>} フォーム配列
 */
export const listForms = async ({ gasUrl, includeArchived = false }) => {
  // google.script.runが利用可能な場合はそれを使用（CORS問題を回避）
  if (hasScriptRun()) {
    const result = await callScriptRun("nfbListForms", { includeArchived });
    if (!result || result.ok === false) {
      throw new Error(result?.error || "フォーム一覧の取得に失敗しました");
    }
    return result.forms || [];
  }

  // fetch APIを使用（スタンドアロン環境）
  if (!gasUrl) throw new Error("GAS URL is required");

  const body = { action: "forms_list", includeArchived };
  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json.forms || [];
};

/**
 * 単一フォームを取得
 * @param {Object} options - オプション
 * @param {string} options.gasUrl - GAS WebApp URL
 * @param {string} options.formId - フォームID
 * @returns {Promise<Object|null>} フォームデータ
 */
export const getForm = async ({ gasUrl, formId }) => {
  if (!formId) throw new Error("formId is required");

  const body = { action: "forms_get", formId };

  if (!gasUrl) throw new Error("GAS URL is required");

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json.form || null;
};

/**
 * フォームを作成
 * @param {Object} options - オプション
 * @param {string} options.gasUrl - GAS WebApp URL
 * @param {Object} options.formData - フォームデータ
 * @param {string} options.saveUrl - 保存先URL（オプション）
 * @returns {Promise<Object>} 作成されたフォーム
 */
export const createForm = async ({ gasUrl, formData, saveUrl }) => {
  if (!formData) throw new Error("formData is required");

  const body = { action: "forms_create", formData, saveUrl };

  if (!gasUrl) throw new Error("GAS URL is required");

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json.form;
};

/**
 * フォームをインポート（ファイルURLから）
 * @param {Object} options - オプション
 * @param {string} options.gasUrl - GAS WebApp URL
 * @param {string} options.fileUrl - Google DriveファイルURL
 * @returns {Promise<Object>} インポートされたフォーム
 */
export const importFormByUrl = async ({ gasUrl, fileUrl }) => {
  if (!fileUrl) throw new Error("fileUrl is required");

  // google.script.runが利用可能な場合はそれを使用（CORS問題を回避）
  if (hasScriptRun()) {
    console.log('[gasClient.importFormByUrl] google.script.runを使用:', { fileUrl });
    const result = await callScriptRun("nfbImportForm", { fileUrl });
    if (!result || result.ok === false) {
      throw new Error(result?.error || "インポートに失敗しました");
    }
    console.log('[gasClient.importFormByUrl] google.script.run成功:', result);
    return result.form;
  }

  // fetch APIを使用（スタンドアロン環境）
  if (!gasUrl) throw new Error("GAS URL is required");

  const body = { action: "forms_import", fileUrl };

  console.log('[gasClient.importFormByUrl] fetch使用:', { gasUrl, fileUrl, body });

  try {
    const res = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      mode: "cors",
    });

    console.log('[gasClient.importFormByUrl] レスポンス受信:', {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      type: res.type
    });

    const json = await res.json().catch((jsonError) => {
      console.error('[gasClient.importFormByUrl] JSON解析エラー:', jsonError);
      return {};
    });

    console.log('[gasClient.importFormByUrl] レスポンスJSON:', json);

    if (!res.ok || json?.ok === false) {
      handleFetchError(res, json);
    }

    return json.form;
  } catch (error) {
    console.error('[gasClient.importFormByUrl] Fetchエラー:', error);
    throw error;
  }
};

/**
 * フォームを更新
 * @param {Object} options - オプション
 * @param {string} options.gasUrl - GAS WebApp URL
 * @param {string} options.formId - フォームID
 * @param {Object} options.updates - 更新内容
 * @returns {Promise<Object>} 更新されたフォーム
 */
export const updateForm = async ({ gasUrl, formId, updates }) => {
  if (!formId) throw new Error("formId is required");
  if (!updates) throw new Error("updates is required");

  const body = { action: "forms_update", formId, updates };

  if (!gasUrl) throw new Error("GAS URL is required");

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json.form;
};

/**
 * フォームを削除
 * @param {Object} options - オプション
 * @param {string} options.gasUrl - GAS WebApp URL
 * @param {string} options.formId - フォームID
 * @returns {Promise<Object>} 削除結果
 */
export const deleteForm = async ({ gasUrl, formId }) => {
  if (!formId) throw new Error("formId is required");

  const body = { action: "forms_delete", formId };

  if (!gasUrl) throw new Error("GAS URL is required");

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json;
};

/**
 * フォームをアーカイブ/アンアーカイブ
 * @param {Object} options - オプション
 * @param {string} options.gasUrl - GAS WebApp URL
 * @param {string} options.formId - フォームID
 * @param {boolean} options.archived - アーカイブ状態
 * @returns {Promise<Object>} 更新されたフォーム
 */
export const setFormArchived = async ({ gasUrl, formId, archived }) => {
  if (!formId) throw new Error("formId is required");
  if (archived === undefined) throw new Error("archived is required");

  const body = { action: "forms_archive", formId, archived };

  if (!gasUrl) throw new Error("GAS URL is required");

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    mode: "cors",
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    handleFetchError(res, json);
  }

  return json.form;
};

// ========================================
// 設定管理API
// ========================================

/**
 * デプロイ済みGAS WebApp URLを自動検出
 * GAS側でHTMLに注入されたグローバル変数を優先的に使用
 * @returns {string} GAS WebApp URL
 */
export const getAutoDetectedGasUrl = () => {
  console.log('[gasClient.getAutoDetectedGasUrl] URL検出開始');

  // 1. GAS側で注入されたグローバル変数を優先
  if (typeof window !== 'undefined' && window.__GAS_WEBAPP_URL__) {
    console.log('[gasClient.getAutoDetectedGasUrl] グローバル変数から取得:', window.__GAS_WEBAPP_URL__);
    return window.__GAS_WEBAPP_URL__;
  }

  // 2. document.referrerを試す（iframe内で実行されている場合）
  let urlString = '';
  if (document.referrer) {
    urlString = document.referrer;
    console.log('[gasClient.getAutoDetectedGasUrl] document.referrerから取得:', urlString);
  }

  // 3. window.locationを試す（通常のアクセスの場合）
  if (!urlString) {
    try {
      const { origin, pathname } = window.location;
      if (origin && pathname) {
        urlString = origin + pathname;
        console.log('[gasClient.getAutoDetectedGasUrl] window.locationから取得:', urlString);
      }
    } catch (e) {
      console.error('[gasClient.getAutoDetectedGasUrl] window.location取得エラー:', e);
    }
  }

  if (!urlString) {
    console.error('[gasClient.getAutoDetectedGasUrl] URL検出失敗: URLが空');
    throw new Error("GAS WebApp環境ではありません。デプロイ済みのWebアプリからアクセスしてください。");
  }

  // GAS WebApp URLのパターン: https://script.google.com/macros/s/{scriptId}/exec
  if (urlString.includes('script.google.com') && urlString.includes('/macros/')) {
    // URLから/execまでの部分を抽出
    const match = urlString.match(/(https:\/\/script\.google\.com\/macros\/s\/[^/]+)\/exec/);
    if (match) {
      const detectedUrl = match[1] + '/exec';
      console.log('[gasClient.getAutoDetectedGasUrl] URL抽出成功:', detectedUrl);
      return detectedUrl;
    }
    // マッチしない場合は、/dev や /edit を /exec に置換
    const transformedUrl = urlString.replace(/\/(dev|edit).*$/, '/exec').split('?')[0].split('#')[0];
    console.log('[gasClient.getAutoDetectedGasUrl] URL変換:', transformedUrl);
    return transformedUrl;
  }

  console.error('[gasClient.getAutoDetectedGasUrl] URL検出失敗: GAS WebAppパターンに一致しない:', urlString);
  throw new Error("GAS WebApp環境ではありません。デプロイ済みのWebアプリからアクセスしてください。");
};
