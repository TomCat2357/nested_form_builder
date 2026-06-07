// 左サイドバー（AppLayout の app-sidebar）の折りたたみ状態を保持するグローバルストア。
//
// サイドバーは画面ごとに AppLayout が再マウントされるため、状態を React のローカル state に
// 置くと画面遷移で失われる。そこでモジュールレベルの単一の真実として保持し、localStorage に
// 永続化することで「どの画面で隠しても他画面へ移動しても隠したまま」「再読み込み後も維持」を
// 満たす。購読パターンは globalSyncState の listeners 方式と同じ。

const STORAGE_KEY = "nfb_sidebar_collapsed_v1";

const readInitial = () => {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    // プライベートモード等で localStorage が使えない場合は展開状態で開始する。
    return false;
  }
};

let collapsed = readInitial();
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener());

export const getSidebarCollapsed = () => collapsed;

export const subscribeSidebarCollapsed = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setSidebarCollapsed = (next) => {
  const value = !!next;
  if (value === collapsed) return;
  collapsed = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // 永続化に失敗してもアプリ内の状態は更新する（最低限セッション中は維持される）。
  }
  emit();
};

export const toggleSidebarCollapsed = () => setSidebarCollapsed(!collapsed);
