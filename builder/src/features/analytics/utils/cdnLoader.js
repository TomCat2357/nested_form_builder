/**
 * CDN から外部 JS ライブラリをランタイムロードするヘルパ。
 *
 * 経緯: GAS HTML Service は `<script>` インライン埋め込みされた JS 内に
 * `<script>` `</head>` などの文字列リテラルが含まれていると HTML タグと誤認し
 * "形式が正しくない HTML コンテンツ" を投げる。
 * alasql / chart.js のソースには該当する文字列リテラルが含まれるため
 * `vite-plugin-singlefile` で bundle に inline せず、CDN から動的ロードする。
 */

const cache = new Map();

function loadFromUrl(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load " + url));
    document.head.appendChild(script);
  });
}

/**
 * URL のリストを順番に試し、いずれか成功したら解決する。
 * 全て失敗した場合は最後のエラーで reject。
 */
function loadWithFallback(urls) {
  return urls.reduce((prev, url) => {
    return prev.catch(() => loadFromUrl(url));
  }, Promise.reject(new Error("init")));
}

/**
 * 指定 URL のスクリプトを 1 度だけロードする (重複呼び出しは同じ Promise を返す)。
 * URL を配列で渡すと、最初のものに失敗したら次へ fallback。
 */
export function loadScriptOnce(urlOrUrls) {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  const cacheKey = urls.join("|");
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const p = loadWithFallback(urls);
  cache.set(cacheKey, p);
  return p;
}

/**
 * alasql 4.x をロードして window.alasql を返す。
 */
export async function loadAlaSql() {
  await loadScriptOnce([
    "https://cdn.jsdelivr.net/npm/alasql@4/dist/alasql.min.js",
    "https://unpkg.com/alasql@4/dist/alasql.min.js",
  ]);
  if (!window.alasql) throw new Error("alasql failed to register on window");
  return window.alasql;
}

/**
 * Chart.js 4.x をロードして window.Chart を返す。
 */
export async function loadChartJs() {
  await loadScriptOnce([
    "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
    "https://unpkg.com/chart.js@4/dist/chart.umd.min.js",
  ]);
  if (!window.Chart) throw new Error("Chart.js failed to register on window");
  return window.Chart;
}
