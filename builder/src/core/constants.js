// 検索対象外の固定メタ列キー。
//   - createdAt / modifiedAt（作成・更新日時）は検索可として残す。
//   - createdBy / modifiedBy（…By 系）と deletedAt / deletedBy（deleted 系）は除外。
// 簡易検索はこの集合で列をフィルタし、SQL モードはテーブル登録時に同じ列を落とす
// （analyticsAlaSql.registerFormAsTable の excludeMetaColumns）。
// core/constants.js は依存の末端なので、3 箇所からここを import しても循環参照は起きない。
export const NON_SEARCHABLE_META_KEYS = ["createdBy", "modifiedBy", "deletedAt", "deletedBy"];

// UI・動作関連
export const MAX_DEPTH = 11;
export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_SEARCH_DEBOUNCE_MS = 300;
export const DEFAULT_DELETED_RETENTION_DAYS = 30;
export const DEFAULT_SHEET_NAME = "Data";
export const GAS_ERROR_CODE_LOCK_TIMEOUT = "LOCK_TIMEOUT";

// 置換フィールド（type:"substitution"）の表示まわり。プレビュー（FieldRenderer）と
// 検索結果一覧（SearchTable）で文言・判定を共有するため、末端の constants へ集約する。
//   - SUBSTITUTION_LOADING_PLACEHOLDER: 子フォームデータ / full-query が未解決の過渡状態に出す表示。
//   - FULL_QUERY_SUBST_RE: templateText が full-query トークン（`{{SELECT ...}}`）を含むかの判定。
export const SUBSTITUTION_LOADING_PLACEHOLDER = "読込中…";
export const FULL_QUERY_SUBST_RE = /\{\{\s*SELECT\b/i;

// IndexedDB ストレージ関連
export const DB_NAME = "NestedFormBuilder";
// v8: フォーム/クエスチョン/ダッシュボードのオフラインファースト保存用に
// アップロードキュー (uploadQueue) ストアを追加。
// v9: 開いたフォーム/ダッシュボードの履歴 (openHistory) ストアを追加。
//     起動時に上位 N 件のレコードを先行プリフェッチする土台。
// v10: registry ストア（フロントの作業キャッシュ）を追加。Script Properties registry
//      （{fileId, 論理パス}）のフロント側ミラー。喪失時は list API / GAS 再構成で再生成可。
// v11: formNavCache ストア（目次ツリーの軽量キャッシュ）を追加。formId キーで
//      buildSchemaMapItems の出力（id/depth/indexLabel/label/children）のみ保存し、
//      フォーム修正画面を開いた瞬間にサイドバー目次を即表示する。ナビ表示専用で
//      編集ソースには流用しない（喪失時はフォーム本体ロード後に再生成）。
export const DB_VERSION = 11;
export const STORE_NAMES = {
  forms: "formsCache",
  settings: "settingsStore",
  analyticsQuestions: "analyticsQuestions",
  analyticsDashboards: "analyticsDashboards",
  uploadQueue: "uploadQueue",
  openHistory: "openHistory",
  registry: "registry",
  formNav: "formNavCache",
};
// v5 → v6 で削除した旧ストア (onupgradeneeded で deleteObjectStore する対象)
export const LEGACY_STORE_NAMES_V5 = [
  "recordsCache",
  "recordsCacheMeta",
  "analyticsSnapshots",
  "analyticsSnapshotsMeta",
];

// キャッシュポリシー（ミリ秒）
export const RECORD_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
export const RECORD_CACHE_BACKGROUND_REFRESH_MS = 5 * 60 * 1000;
// 一覧キャッシュ（フォーム / Dashboard / Question で共通）の SWR しきい値。
//   - 1 時間以内: そのまま信用（再取得しない）
//   - 1 時間〜24 時間: 仮に信用して即表示し、バックグラウンドで更新確認
//   - 24 時間以上: 信用せず同期的に取得し直す
export const FORM_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const FORM_CACHE_BACKGROUND_REFRESH_MS = 60 * 60 * 1000;
// 分析（Question / Dashboard）の元レコードテーブルを React メモリにキャッシュする TTL（1時間）。
// フィルタの微調整ごとに dataStore.listEntries + 行変換を再実行しないための短期キャッシュ。
export const ANALYTICS_SOURCE_TABLE_CACHE_TTL_MS = 60 * 60 * 1000;

// 開いた履歴に基づく先行プリフェッチ（openHistory ストア）。
//   - PREFETCH_TOP_N: 起動時にレコードを先読みする上位件数（フォーム / ダッシュボードそれぞれ）。
//   - OPEN_HISTORY_MAX_ENTRIES: 履歴の保持上限。超過分は古い順に prune して肥大を防ぐ。
//   - OPEN_HISTORY_HALF_LIFE_DAYS: ランキングスコアの recency 減衰の半減期（日）。
//     score = openCount * 2^(-ageDays / HALF_LIFE) で「よく開く × 最近」を両立させる。
export const PREFETCH_TOP_N = 5;
export const OPEN_HISTORY_MAX_ENTRIES = 200;
export const OPEN_HISTORY_HALF_LIFE_DAYS = 14;

// オフラインファースト保存のバックグラウンドアップロード再試行（指数バックオフ）。
//   待機時間 = min(BASE * 2^attempt, MAX) + ジッタ。手動「再試行」でバックオフを解除できる。
export const UPLOAD_RETRY_BASE_MS = 2 * 1000;
export const UPLOAD_RETRY_MAX_MS = 5 * 60 * 1000;

// 日時処理関連
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const SERIAL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
// |n| >= 1e11 (≒ 1973-03-03 以降) なら unix ms とみなす境界。
// それ未満は unix 秒（×1000）または Sheets シリアル番号として再解釈する。
export const UNIX_MS_THRESHOLD = 100000000000;
