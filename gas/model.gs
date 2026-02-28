function Model_normalizeSpreadsheetId_(input) {
  var value = String(input || "").trim();
  if (!value) return "";

  if (/^https?:\/\//i.test(value)) {
    var idMatch = value.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (idMatch && idMatch[1]) return idMatch[1];
    var keyMatch = value.match(/[?&]key=([a-zA-Z0-9-_]+)/);
    if (keyMatch && keyMatch[1]) return keyMatch[1];
  }

  return value;
}

function Model_normalizeContext_(body = {}, params = {}) {
  const responses = (body.responses && typeof body.responses === "object") ? body.responses : {};
  const order = (Array.isArray(body.order) && body.order.length) ? body.order : Object.keys(responses);
  const rowIndexHint = typeof body.rowIndexHint === "number" ? body.rowIndexHint : (typeof params.rowIndexHint === "number" ? params.rowIndexHint : null);

  return {
    version: body.version || 1,
    formTitle: body.formTitle || "",
    schemaHash: body.schemaHash || "",
    spreadsheetId: Model_normalizeSpreadsheetId_(params.spreadsheetId || body.spreadsheetId || ""),
    sheetName: params.sheetName || body.sheetName || NFB_DEFAULT_SHEET_NAME,
    id: body.id || params.id || "",
    responses,
    order,
    lastSpreadsheetReadAt: body.lastSpreadsheetReadAt || body.lastSyncedAt || params.lastSpreadsheetReadAt || params.lastSyncedAt || null,
    forceFullSync: body.forceFullSync === true || params.forceFullSync === 'true',
    rowIndexHint,
    raw: body,
  };
}

function Model_parseRequest_(e) {
  let body = {};
  if (e?.postData?.contents) {
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      Logger.log(`[Model_parseRequest_] JSON parse error: ${nfbErrorToString_(err)}`);
    }
  }
  const params = e?.parameter || {};
  return Model_normalizeContext_(body, params);
}

const Model_fromScriptRunPayload_ = (payload) => Model_normalizeContext_(payload || {}, {});
