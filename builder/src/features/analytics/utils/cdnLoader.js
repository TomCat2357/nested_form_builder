/**
 * CDN から外部 JS ライブラリをランタイムロードするヘルパ。
 *
 * 経緯: GAS HTML Service は `<script>` インライン埋め込みされた JS 内に
 * `<script>` `</head>` などの文字列リテラルが含まれていると HTML タグと誤認し
 * "形式が正しくない HTML コンテンツ" を投げる。
 * alasql / chart.js のソースには該当する文字列リテラルが含まれるため
 * `vite-plugin-singlefile` で bundle に inline せず、CDN から動的ロードする。
 */

import { wrapArray } from "../../../utils/arrays.js";

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
function loadScriptOnce(urlOrUrls) {
  const urls = wrapArray(urlOrUrls);
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
 * 続けて chartjs-adapter-date-fns (bundle 版 = date-fns 同梱) をロードし、
 * `scales.x.type === "time"` 等の時間軸描画を有効化する。
 */
export async function loadChartJs() {
  await loadScriptOnce([
    "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
    "https://unpkg.com/chart.js@4/dist/chart.umd.min.js",
  ]);
  if (!window.Chart) throw new Error("Chart.js failed to register on window");
  await loadScriptOnce([
    "https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js",
    "https://unpkg.com/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js",
  ]);
  return window.Chart;
}

/**
 * ECharts 5.x をロードして window.echarts を返す (sunburst / sankey 用)。
 * sunburst / sankey 等の高度な可視化を担当する。
 */
export async function loadEcharts() {
  await loadScriptOnce([
    "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js",
    "https://unpkg.com/echarts@5/dist/echarts.min.js",
  ]);
  if (!window.echarts) throw new Error("ECharts failed to register on window");
  return window.echarts;
}

/**
 * 指定 URL の CSS を 1 度だけロードする (重複呼び出しは即解決)。
 * Leaflet 等で外部スタイルシートが必要なライブラリ用。
 */
function loadStylesheetOnce(href) {
  const cacheKey = "css:" + href;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const p = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("Failed to load CSS: " + href));
    document.head.appendChild(link);
  });
  cache.set(cacheKey, p);
  return p;
}

/**
 * Leaflet 1.9 をロードして window.L を返す (地図系: pinMap / gridMap / regionMap)。
 * CSS と JS の両方をロードする。
 */
export async function loadLeaflet() {
  await loadStylesheetOnce("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css");
  await loadScriptOnce([
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  ]);
  if (!window.L) throw new Error("Leaflet failed to register on window");
  return window.L;
}

/**
 * react-grid-layout 1.4.x をロードして window.ReactGridLayout を返す。
 * Metabase 風ダッシュボードの 12 列グリッド配置・リサイズに使用する。
 *
 * 注意: UMD ビルドが React/ReactDOM のグローバル参照を要求する。
 * 呼び出し前に `window.React = React; window.ReactDOM = ReactDOM` を仕込むこと。
 * CSS は本体と react-resizable の 2 種が必要。
 */
export async function loadReactGridLayout() {
  if (!window.React || !window.ReactDOM) {
    throw new Error("React/ReactDOM globals must be set before loading react-grid-layout");
  }
  await loadStylesheetOnce("https://cdn.jsdelivr.net/npm/react-grid-layout@1.4.4/css/styles.css");
  await loadStylesheetOnce("https://cdn.jsdelivr.net/npm/react-resizable@3.0.5/css/styles.css");
  await loadScriptOnce([
    "https://cdn.jsdelivr.net/npm/react-grid-layout@1.4.4/dist/react-grid-layout.min.js",
    "https://unpkg.com/react-grid-layout@1.4.4/dist/react-grid-layout.min.js",
  ]);
  if (!window.ReactGridLayout) throw new Error("react-grid-layout failed to register on window");
  return window.ReactGridLayout; // { default: GridLayout, Responsive, WidthProvider }
}
