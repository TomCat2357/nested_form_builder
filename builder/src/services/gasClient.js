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
  if (res.status === 401 || res.status === 403) {
    throw new Error("GAS WebApp へのアクセスが許可されていません。デプロイの公開範囲が『全員』になっているか確認してください。");
  }
  if (res.type === "opaqueredirect") {
    throw new Error("GAS WebApp がリダイレクトを返しました。アクセス権限またはURLを確認してください。");
  }
  throw new Error(json?.error || `${res.status} ${res.statusText}`);
};

export const callScriptFunction = (functionName, payload) =>
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
    const result = await callScriptFunction("nfbLoadUserSettings");
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
    const result = await callScriptFunction("nfbSaveUserSettings", settings || {});
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
    const result = await callScriptFunction("saveResponses", body);
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
    const result = await callScriptFunction("deleteRecord", payload);
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
    const result = await callScriptFunction("getRecord", payload);
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
    const result = await callScriptFunction("listRecords", payload);
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
