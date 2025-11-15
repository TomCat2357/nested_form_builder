var NFB_USER_SETTINGS_PREFIX = "NFB_USER_SETTINGS_";
var NFB_USER_SETTINGS_KEYS = {
  formTitle: NFB_USER_SETTINGS_PREFIX + "FORM_TITLE",
  spreadsheetId: NFB_USER_SETTINGS_PREFIX + "SPREADSHEET_ID",
  sheetName: NFB_USER_SETTINGS_PREFIX + "SHEET_NAME",
  gasUrl: NFB_USER_SETTINGS_PREFIX + "GAS_URL",
  pageSize: NFB_USER_SETTINGS_PREFIX + "PAGE_SIZE",
};

function nfbNormalizeSettings_(input) {
  input = input || {};
  return {
    formTitle: String(input.formTitle || ""),
    spreadsheetId: String(input.spreadsheetId || ""),
    sheetName: String(input.sheetName || "Responses"),
    gasUrl: String(input.gasUrl || ""),
    pageSize: Number(input.pageSize) || 20,
  };
}

function nfbLoadUserSettings() {
  var props = PropertiesService.getUserProperties();
  return {
    formTitle: props.getProperty(NFB_USER_SETTINGS_KEYS.formTitle) || "",
    spreadsheetId: props.getProperty(NFB_USER_SETTINGS_KEYS.spreadsheetId) || "",
    sheetName: props.getProperty(NFB_USER_SETTINGS_KEYS.sheetName) || "Responses",
    gasUrl: props.getProperty(NFB_USER_SETTINGS_KEYS.gasUrl) || "",
    pageSize: Number(props.getProperty(NFB_USER_SETTINGS_KEYS.pageSize)) || 20,
  };
}

function nfbSaveUserSettings(settings) {
  var normalized = nfbNormalizeSettings_(settings);
  var props = PropertiesService.getUserProperties();
  var payload = {};
  payload[NFB_USER_SETTINGS_KEYS.formTitle] = normalized.formTitle;
  payload[NFB_USER_SETTINGS_KEYS.spreadsheetId] = normalized.spreadsheetId;
  payload[NFB_USER_SETTINGS_KEYS.sheetName] = normalized.sheetName;
  payload[NFB_USER_SETTINGS_KEYS.gasUrl] = normalized.gasUrl;
  payload[NFB_USER_SETTINGS_KEYS.pageSize] = String(normalized.pageSize);
  props.setProperties(payload, true);
  return nfbLoadUserSettings();
}
