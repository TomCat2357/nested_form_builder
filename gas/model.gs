function Model_normalizeContext_(body, params) {
  body = body || {};
  params = params || {};

  var responses = (body.responses && typeof body.responses === "object") ? body.responses : {};
  var order = (Array.isArray(body.order) && body.order.length) ? body.order : Object.keys(responses);
  var rowIndexHint = (typeof body.rowIndexHint === "number") ? body.rowIndexHint : (typeof params.rowIndexHint === "number" ? params.rowIndexHint : null);
  return {
    version: body.version || 1,
    formTitle: body.formTitle || "",
    schemaHash: body.schemaHash || "",
    spreadsheetId: params.spreadsheetId || body.spreadsheetId || "",
    sheetName: params.sheetName || body.sheetName || "Data",
    id: body.id || params.id || "",
    responses: responses,
    order: order,
    rowIndexHint: rowIndexHint,
    raw: body,
  };
}

function Model_parseRequest_(e) {
  var body = {};
  if (e && e.postData && e.postData.contents) {
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      Logger.log("[Model_parseRequest_] JSON parse error: " + nfbErrorToString_(err));
    }
  }

  var params = e && e.parameter ? e.parameter : {};
  return Model_normalizeContext_(body, params);
}

function Model_fromScriptRunPayload_(payload) {
  return Model_normalizeContext_(payload || {}, {});
}
