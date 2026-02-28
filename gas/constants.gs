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
var NFB_HEADER_START_ROW = 1;
var NFB_DATA_START_ROW = NFB_HEADER_START_ROW + NFB_HEADER_DEPTH;
var NFB_SERVER_COMMIT_TOKEN = "NFB_SERVER_COMMIT_TOKEN";
var NFB_SHEET_LAST_UPDATED_AT_PREFIX = "NFB_SHEET_LAST_UPDATED_AT";
var NFB_FIXED_HEADER_PATHS = [["id"], ["No."], ["createdAt"], ["modifiedAt"], ["deletedAt"], ["createdBy"], ["modifiedBy"], ["deletedBy"]];
var NFB_DEFAULT_SHEET_NAME = "Data";

// 日時処理関連
var NFB_TZ = "Asia/Tokyo";
var NFB_JST_OFFSET_MS = 9 * 60 * 60 * 1000;
var NFB_MS_PER_DAY = 24 * 60 * 60 * 1000;
var NFB_SHEETS_EPOCH_MS = new Date(1899, 11, 30, 0, 0, 0).getTime();
var NFB_ULID_RANDOM_LENGTH = 16;
var NFB_LAST_ULID_TS_MS = -1;
var NFB_LAST_ULID_RANDOM = "";

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

function Nfb_ulidAlphabet_() {
  return "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
}

function Nfb_encodeUlidTime_(unixMs) {
  var alphabet = Nfb_ulidAlphabet_();
  var value = Math.floor(Number(unixMs));
  if (!isFinite(value) || value < 0) value = 0;

  var chars = [];
  for (var i = 0; i < 10; i++) {
    chars.unshift(alphabet.charAt(value % 32));
    value = Math.floor(value / 32);
  }
  return chars.join("");
}

function Nfb_encodeUlidRandom_(bytes) {
  var alphabet = Nfb_ulidAlphabet_();
  var encoded = "";
  var buffer = 0;
  var bits = 0;

  for (var i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;

    while (bits >= 5) {
      encoded += alphabet.charAt((buffer >> (bits - 5)) & 31);
      bits -= 5;
      if (bits === 0) {
        buffer = 0;
      } else {
        buffer = buffer & ((1 << bits) - 1);
      }
    }
  }

  if (bits > 0) {
    encoded += alphabet.charAt((buffer << (5 - bits)) & 31);
  }

  return encoded;
}

function Nfb_createUlidRandomPart_() {
  return Nfb_encodeUlidRandom_(Nfb_createRandomBytes_(10)).substring(0, NFB_ULID_RANDOM_LENGTH);
}

function Nfb_incrementUlidRandom_(value) {
  var alphabet = Nfb_ulidAlphabet_();
  var chars = String(value || "").split("");
  while (chars.length < NFB_ULID_RANDOM_LENGTH) chars.push(alphabet.charAt(0));
  if (chars.length > NFB_ULID_RANDOM_LENGTH) chars = chars.slice(0, NFB_ULID_RANDOM_LENGTH);

  for (var i = chars.length - 1; i >= 0; i--) {
    var idx = alphabet.indexOf(chars[i]);
    var safeIdx = idx >= 0 ? idx : 0;
    if (safeIdx < alphabet.length - 1) {
      chars[i] = alphabet.charAt(safeIdx + 1);
      for (var j = i + 1; j < chars.length; j++) chars[j] = alphabet.charAt(0);
      return { value: chars.join(""), overflow: false };
    }
    chars[i] = alphabet.charAt(0);
  }

  return { value: chars.join(""), overflow: true };
}

function Nfb_generateUlid_() {
  var nowMs = Math.floor(Number(new Date().getTime()));
  if (!isFinite(nowMs) || nowMs < 0) nowMs = 0;

  if (NFB_LAST_ULID_TS_MS < 0 || nowMs > NFB_LAST_ULID_TS_MS) {
    NFB_LAST_ULID_TS_MS = nowMs;
    NFB_LAST_ULID_RANDOM = Nfb_createUlidRandomPart_();
    return Nfb_encodeUlidTime_(NFB_LAST_ULID_TS_MS) + NFB_LAST_ULID_RANDOM;
  }

  if (!NFB_LAST_ULID_RANDOM || NFB_LAST_ULID_RANDOM.length !== NFB_ULID_RANDOM_LENGTH) {
    NFB_LAST_ULID_RANDOM = Nfb_createUlidRandomPart_();
  }

  var incremented = Nfb_incrementUlidRandom_(NFB_LAST_ULID_RANDOM);
  if (incremented.overflow) {
    NFB_LAST_ULID_TS_MS += 1;
    NFB_LAST_ULID_RANDOM = Nfb_createUlidRandomPart_();
  } else {
    NFB_LAST_ULID_RANDOM = incremented.value;
  }

  return Nfb_encodeUlidTime_(NFB_LAST_ULID_TS_MS) + NFB_LAST_ULID_RANDOM;
}

function Nfb_generateCompactId_(prefix) {
  var ulidPart = Nfb_generateUlid_();
  var randomPart = Nfb_toBase64Url_(Nfb_createRandomBytes_(6)).substring(0, 8);
  return String(prefix || "") + "_" + ulidPart + "_" + randomPart;
}

function Nfb_generateFormId_() {
  return Nfb_generateCompactId_("f");
}

function Nfb_generateRecordId_() {
  return Nfb_generateCompactId_("r");
}
