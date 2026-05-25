/**
 * アプリの絶対 URL を組み立てるヘルパ。
 *
 * GAS Web App は二重 iframe 構造で配信される:
 *   外側: script.google.com/.../dev  (doGet がここで動く)
 *   内側: googleusercontent.com/...  (React が実際に走る)
 *
 * このため外側 URL に `#/admin/foo` を付けても内側 iframe には伝播しない
 * (HashRouter は内側 iframe の window.location.hash を読むため空のままになる)。
 *
 * 解決策: 外側 URL にはハッシュではなく `?route=<encoded path>` を載せ、
 * doGet が `window.__INITIAL_HASH__` として注入 → React 起動直前に
 * applyInitialHashFromGas() で window.location.hash に書き戻す。
 *
 * dev (Vite) では iframe 構造が無いので従来どおり `#/...` を返す。
 */

/**
 * SPA 内の任意のハッシュパスを、新タブで安全に開ける絶対 URL に変換する。
 * @param {string} hashPath "/admin/questions/abc" のような hash router パス。
 *                          先頭の "#" は省略可。
 * @returns {string} 新タブで開く絶対 URL。
 */
export function buildAppUrl(hashPath) {
  const path = typeof hashPath === "string" ? hashPath : "";
  const normalizedPath = normalizePath(path);
  const injected = typeof window !== "undefined" ? window.__GAS_WEBAPP_URL__ : null;

  if (typeof injected === "string" && injected) {
    const base = stripHash(injected);
    const sep = base.indexOf("?") >= 0 ? "&" : "?";
    return base + sep + "route=" + encodeURIComponent(normalizedPath);
  }

  const base = typeof window !== "undefined" && window.location
    ? stripHash(window.location.origin + window.location.pathname + window.location.search)
    : "";
  return base + "#" + normalizedPath;
}

/**
 * doGet が注入した window.__INITIAL_HASH__ を window.location.hash に反映する。
 * React (HashRouter) の起動前に呼ぶこと。
 *
 * 既に hash が設定されている場合は上書きしない (例: 開発時に直接 #/foo を踏んだケース)。
 */
export function applyInitialHashFromGas() {
  if (typeof window === "undefined") return;
  const initial = window.__INITIAL_HASH__;
  if (typeof initial !== "string" || !initial) return;
  const currentHash = window.location.hash || "";
  if (currentHash && currentHash !== "#" && currentHash !== "#/") return;
  const normalized = normalizePath(initial);
  if (typeof window.history?.replaceState === "function") {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", pathname + search + "#" + normalized);
  } else {
    window.location.hash = "#" + normalized;
  }
}

function normalizePath(path) {
  if (!path) return "/";
  const noHash = path.startsWith("#") ? path.slice(1) : path;
  return noHash.startsWith("/") ? noHash : "/" + noHash;
}

function stripHash(url) {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}
