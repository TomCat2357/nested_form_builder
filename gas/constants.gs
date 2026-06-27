// 管理者設定関連
var NFB_ADMIN_KEY = "ADMIN_KEY";
var NFB_ADMIN_EMAIL = "ADMIN_EMAIL";
var NFB_RESTRICT_TO_FORM_ONLY = "RESTRICT_TO_FORM_ONLY";
var NFB_EXT_ACTION_SECRET = "NFB_EXT_ACTION_SECRET";
var NFB_GROUP_MEMBER_CACHE = "NFB_GROUP_MEMBER_CACHE";
var NFB_GROUP_CACHE_LAST_ATTEMPT_AT = "NFB_GROUP_CACHE_LAST_ATTEMPT_AT";
var NFB_GROUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
var NFB_GROUP_CACHE_RETRY_INTERVAL_MS = 60 * 60 * 1000;
var NFB_PROPERTY_STORE_MODE = "__NFB_PROPERTY_STORE_MODE__";
var NFB_PROPERTY_STORE_MODE_SCRIPT = "script";
var NFB_PROPERTY_STORE_MODE_USER = "user";

// フォーム管理関連（Google Drive）
var FORMS_FOLDER_NAME = "Nested Form Builder - Forms";
var FORMS_PROPERTY_KEY = "nfb.forms.mapping";
var FORMS_PROPERTY_VERSION = 2;

// フォルダ登録簿（空フォルダも永続化する。{ version, folders: ["a", "a/b", ...] } 形）
var NFB_FOLDERS_PROPERTY_KEY = "nfb.forms.folders";
var NFB_FOLDERS_PROPERTY_VERSION = 1;

// 仮想フォルダパス → 物理 Drive フォルダ ID のマップ（{ version, map: { "a/b": "<folderId>", ... } } 形）。
// 物理 Drive フォルダ階層（01_forms 配下）と仮想フォルダの対応を O(1) で解決するためのキャッシュ。
var NFB_FOLDER_DRIVE_MAP_PROPERTY_KEY = "nfb.forms.folders.drivemap";
var NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION = 1;

// Question / Dashboard 用の仮想フォルダパス → 物理 Drive フォルダ ID マップ（02_questions / 03_dashboards 配下）。
// forms の drivemap と同じ形・同じ version 規則で、type ごとに別キーへ保存する。
var NFB_ANALYTICS_QUESTIONS_FOLDER_DRIVE_MAP_KEY = "nfb.analytics.questions.folders.drivemap";
var NFB_ANALYTICS_DASHBOARDS_FOLDER_DRIVE_MAP_KEY = "nfb.analytics.dashboards.folders.drivemap";

// API/バッチ処理関連
var NFB_DRIVE_API_BATCH_SIZE = 100;
var NFB_LOCK_WAIT_TIMEOUT_MS = 10000;
var NFB_ERROR_CODE_LOCK_TIMEOUT = "LOCK_TIMEOUT";
// 内部エラー時にクライアントへ返す汎用メッセージ（errors.gs / Code.gs で共用）。
var NFB_GENERIC_INTERNAL_ERROR_MESSAGE = "処理中にエラーが発生しました";
var NFB_DELETED_RECORD_RETENTION_DAYS_KEY = "NFB_DELETED_RECORD_RETENTION_DAYS";
var NFB_DEFAULT_DELETED_RECORD_RETENTION_DAYS = 30;

// アップロード検証関連
// base64 デコード前にサイズを概算チェックして GAS のメモリ枯渇を防ぐ。
var NFB_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// 実行可能形式の拡張子（小文字・ドットなし）。Drive に保存させない denylist。
var NFB_BLOCKED_UPLOAD_EXTENSIONS = ["exe", "bat", "cmd", "com", "msi", "scr", "js", "vbs", "vbe", "wsf", "wsh", "ps1", "sh", "jar", "app", "cpl", "hta", "jse"];

// レート制限関連
var NFB_RATE_LIMIT_PER_MINUTE = 120;
// デプロイ種別の手動上書き（"test" | "prod"）。未設定時は焼き込み値→getUrl ヒューリスティック→既定 prod。
var NFB_DEPLOY_MODE_KEY = "NFB_DEPLOY_MODE";
// deploy.ps1 がビルド時に "test"/"prod" へ置換する焼き込みデプロイ種別。
// 未置換（手動 bundle 等）の場合はプレースホルダのまま残り、heuristic→prod にフォールバックする。
var NFB_DEPLOY_MODE_BAKED = "__NFB_DEPLOY_MODE__";
// deploy.ps1 が Bundle.gs（バックエンド）をデプロイした時刻を焼き込む（"yyyy-MM-dd HH:mm:ss JST"）。
// index.html 側の <meta name="deploy-time"> はフロントの、こちらはバックエンドのデプロイ時刻。
// 未置換（手動 bundle 等）の場合はプレースホルダのまま残るので、API 側で空文字へ正規化する。
var NFB_DEPLOY_TIME_BAKED = "__NFB_DEPLOY_TIME__";

// スプレッドシート・ヘッダー関連
var NFB_HEADER_DEPTH = 11;
var NFB_HEADER_START_ROW = 1;
var NFB_DATA_START_ROW = NFB_HEADER_START_ROW + NFB_HEADER_DEPTH;
var NFB_SERVER_MODIFIED_AT = "NFB_SERVER_MODIFIED_AT";
var NFB_SERVER_COMMIT_TOKEN = NFB_SERVER_MODIFIED_AT;
var NFB_SHEET_LAST_UPDATED_AT_PREFIX = "NFB_SHEET_LAST_UPDATED_AT";
// 固定メタ列。この配列順がそのまま物理列の先頭固定位置（メタ列 i → 物理列 i+1）になる。
// 順序は sheetsRowOps.gs / codeSyncRecords.gs の位置決め書き込み (rowData[0..7]) が依存するため不変。
// pid は親レコード ID を保持する追加メタ列で、メタ列ブロックの最後（deletedBy の直後・データ列の前）に置く。
// Sheets_ensureHeaderMatrix_ → Sheets_repairMetaColumnPositions_ が全メタ列を一律に正規位置へ揃える
// （欠落は正規位置へ挿入、位置ずれは移動。pid だけの特別処理は持たない）。既存シートで pid が無ければ
// deletedBy の直後へ挿入され、既存のデータ列は右へシフトする。fixedColMap は読み取り経路（修整前の
// シート）でもヘッダーパスから動的解決できるよう維持する。
var NFB_FIXED_HEADER_PATHS = [["id"], ["No."], ["createdAt"], ["modifiedAt"], ["deletedAt"], ["createdBy"], ["modifiedBy"], ["deletedBy"], ["pid"]];
var NFB_RESERVED_HEADER_KEYS = {};
for (var i = 0; i < NFB_FIXED_HEADER_PATHS.length; i++) {
  NFB_RESERVED_HEADER_KEYS[NFB_FIXED_HEADER_PATHS[i][0]] = true;
}
var NFB_DEFAULT_SHEET_NAME = "Data";
var NFB_UI_TEMP_KEYS = ["_savedChoiceState", "_savedStyleSettings", "_savedChildrenForChoice", "_savedDisplayModeForChoice"];
var NFB_RECORD_TEMP_FOLDER_PREFIX = "NFB_RECORD_TEMP_";

// 日時処理関連
var NFB_TZ = "Asia/Tokyo";
var NFB_JST_OFFSET_MS = 9 * 60 * 60 * 1000;
var NFB_MS_PER_DAY = 24 * 60 * 60 * 1000;
var NFB_SHEETS_EPOCH_MS = new Date(1899, 11, 30, 0, 0, 0).getTime();
// アプリ内部は canonical 文字列だが、スプレッドシート上の date / time / 日時セルは
// 数値の日時シリアル値（Date オブジェクト）で書き込む。その表示書式（24 時間表記）。
var NFB_SHEETS_DATE_FORMAT = "yyyy/mm/dd";
var NFB_SHEETS_TIME_FORMAT = "hh:mm:ss";
var NFB_SHEETS_DATETIME_FORMAT = "yyyy/mm/dd hh:mm:ss";
// 自由記述系フィールド（text / phone など）と選択肢マーカー列に与えるプレーンテキスト書式。
// "1-1" を日付に、"007" を数値に勝手に変換させないため、値書き込み前にこの書式を割り当てる。
var NFB_SHEETS_TEXT_FORMAT = "@";
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

function Nfb_generateRecordId_() {
  return Nfb_generateCompactId_("r");
}

/**
 * ID の配列（または単一 ID）を文字列配列に正規化する。空値を除外し重複も除外する。
 * forms / analytics の一括削除・一括アーカイブで共通利用。
 * @param {Array<string>|string} ids
 * @return {Array<string>}
 */
function Nfb_normalizeIdList_(ids) {
  var source = Array.isArray(ids) ? ids : [ids];
  var seen = {};
  var normalized = [];
  for (var i = 0; i < source.length; i++) {
    var raw = source[i];
    if (!raw) continue;
    var id = String(raw);
    if (seen[id]) continue;
    seen[id] = true;
    normalized.push(id);
  }
  return normalized;
}

/**
 * 値を文字列化して trim する。null / undefined / 空値は空文字を返す
 * （String(null) === "null" を避けるため、falsy はそのまま "" へ畳む）。
 * @param {*} value
 * @return {string}
 */
function Nfb_trimStr_(value) {
  return value ? String(value).trim() : "";
}
