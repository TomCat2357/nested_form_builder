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
var NFB_FIXED_HEADER_PATHS = [["id"], ["No."], ["createdAt"], ["modifiedAt"], ["createdBy"], ["modifiedBy"]];
var NFB_DEFAULT_SHEET_NAME = "Data";

// 日時処理関連
var NFB_TZ = "Asia/Tokyo";
var NFB_MS_PER_DAY = 24 * 60 * 60 * 1000;
var NFB_SHEETS_EPOCH_MS = new Date(1899, 11, 30, 0, 0, 0).getTime();
