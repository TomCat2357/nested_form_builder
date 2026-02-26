// 管理者設定関連
var NFB_ADMIN_KEY = "ADMIN_KEY";
var NFB_ADMIN_EMAIL = "ADMIN_EMAIL";
var NFB_RESTRICT_TO_FORM_ONLY = "RESTRICT_TO_FORM_ONLY";
var NFB_PROPERTY_STORE_MODE = "__NFB_PROPERTY_STORE_MODE__";
var NFB_PROPERTY_STORE_MODE_SCRIPT = "script";
var NFB_PROPERTY_STORE_MODE_USER = "user";

// フォーム管理関連（Google Drive）
var FORMS_FOLDER_NAME = "Nested Form Builder - Forms";
var FORMS_PROPERTY_KEY = "nfb.forms.mapping"; 
var FORMS_PROPERTY_VERSION = 2; 

// API/バッチ処理関連
var NFB_DRIVE_API_BATCH_SIZE = 100;
var NFB_LOCK_WAIT_TIMEOUT_MS = 10000;
var NFB_ERROR_CODE_LOCK_TIMEOUT = "LOCK_TIMEOUT";

// スプレッドシート・ヘッダー関連
var NFB_HEADER_DEPTH = 11;
var NFB_METADATA_ROWS = 1;
var NFB_HEADER_START_ROW = NFB_METADATA_ROWS + 1;
var NFB_DATA_START_ROW = NFB_HEADER_START_ROW + NFB_HEADER_DEPTH;
var NFB_SHEET_LAST_UPDATED_LABEL = "最終更新時間";
var NFB_FIXED_HEADER_PATHS = [["id"], ["No."], ["createdAt"], ["modifiedAt"], ["createdBy"], ["modifiedBy"]];
var NFB_DEFAULT_SHEET_NAME = "Data";

// 日時処理関連
var NFB_TZ = "Asia/Tokyo";
var NFB_MS_PER_DAY = 24 * 60 * 60 * 1000;
var NFB_SHEETS_EPOCH_MS = new Date(1899, 11, 30, 0, 0, 0).getTime();

function Nfb_toSixByteTimestamp_(unixMs) {
  var value = Math.floor(Number(unixMs));
  if (!isFinite(value) || value < 0) value = 0;

  var bytes = [];
  for (var i = 5; i >= 0; i--) {
    bytes[i] = value & 255;
    value = Math.floor(value / 256);
  }
  return bytes;
}

function Nfb_createRandomBytes_(size) {
  var bytes = [];
  for (var i = 0; i < size; i++) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  return bytes;
}

function Nfb_toBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function Nfb_generateCompactId_(prefix) {
  var tsPart = Nfb_toBase64Url_(Nfb_toSixByteTimestamp_(new Date().getTime()));
  var randomPart = Nfb_toBase64Url_(Nfb_createRandomBytes_(6));
  return String(prefix || "") + "_" + tsPart + "_" + randomPart;
}

function Nfb_generateFormId_() {
  return Nfb_generateCompactId_("f");
}

function Nfb_generateRecordId_() {
  return Nfb_generateCompactId_("r");
}
