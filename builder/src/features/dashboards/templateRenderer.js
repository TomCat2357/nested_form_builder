/**
 * ダッシュボード HTML テンプレートのトークン差込ロジック。
 *
 * サポートトークン:
 *   {{widget:<widgetId>}}      - <div data-widget-id="..."> に置換 (描画ターゲット)
 *   {{value:<queryId>.<col>[.<row>]}} - クエリ結果の単一値を差し込み (デフォルトは 0 行目)
 *   {{table:<queryId>}}        - クエリ結果を <table> として展開
 *   {{param:<name>}}           - パラメータ値の差込
 *   {{_NOW}}                   - 現在時刻 ISO 8601
 */

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

const escapeHtml = (value) => {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const formatCellForTable = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch (_err) { return String(value); }
  }
  return String(value);
};

const renderTable = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<table class="nfb-dash-table"><tbody><tr><td>データなし</td></tr></tbody></table>';
  }
  const columns = Object.keys(rows[0] || {});
  const head = `<thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(formatCellForTable(row?.[c]))}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<table class="nfb-dash-table">${head}${body}</table>`;
};

const resolveValueToken = (raw, queryResults) => {
  // 例: q_daily.total_amount または q_daily.total_amount.0
  const parts = raw.split(".");
  if (parts.length < 2) return "";
  const queryId = parts[0];
  const colName = parts[1];
  const rowIndex = parts.length >= 3 ? Number(parts[2]) : 0;
  const rows = queryResults?.[queryId];
  if (!Array.isArray(rows)) return "";
  const target = rows[Number.isFinite(rowIndex) ? rowIndex : 0];
  if (!target) return "";
  return escapeHtml(target[colName]);
};

const resolveToken = (token, ctx) => {
  const trimmed = token.trim();
  if (trimmed === "_NOW") return escapeHtml(new Date().toISOString());

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return "";
  const kind = trimmed.slice(0, colonIdx).trim();
  const arg = trimmed.slice(colonIdx + 1).trim();
  if (!arg) return "";

  switch (kind) {
    case "widget":
      // 描画ターゲット用の DIV。後続で iframe 内に挿入されたあと echarts.init で描画される
      return `<div data-widget-id="${escapeHtml(arg)}" class="nfb-dash-widget-target"></div>`;
    case "value":
      return resolveValueToken(arg, ctx.queryResults);
    case "table": {
      const rows = ctx.queryResults?.[arg];
      return renderTable(Array.isArray(rows) ? rows : []);
    }
    case "param":
      return escapeHtml(ctx.params?.[arg] ?? "");
    default:
      return "";
  }
};

export function renderTemplate(html, { queryResults = {}, params = {} } = {}) {
  if (typeof html !== "string") return "";
  return html.replace(TOKEN_RE, (_match, token) => resolveToken(token, { queryResults, params }));
}

/**
 * iframe srcDoc にそのまま渡せる HTML を組み立てる。
 * 既存の <html>/<body> がない場合は最小ラッパーで包む。
 */
export function buildIframeDocument(html) {
  const safe = typeof html === "string" ? html : "";
  if (/<html[\s>]/i.test(safe)) return safe;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 16px; color: #1a1a1a; }
  .nfb-dash-table { border-collapse: collapse; width: 100%; }
  .nfb-dash-table th, .nfb-dash-table td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  .nfb-dash-table th { background: #f5f5f5; }
  .nfb-dash-widget-target { min-height: 320px; margin: 16px 0; }
</style>
</head>
<body>
${safe}
</body>
</html>`;
}

/**
 * iframe マウント後にウィジェットターゲットを取得して echarts を初期化するヘルパ。
 * @param {HTMLIFrameElement} iframeEl
 * @param {Object} widgetsById - { [widgetId]: { widget, rows } }
 * @param {Object} echartsInstance - echartsRegistry の default export
 * @returns {Function} cleanup 関数
 */
export function mountWidgetsIntoIframe(iframeEl, widgetsById, echartsInstance, buildOption) {
  if (!iframeEl || !iframeEl.contentDocument) return () => {};
  const doc = iframeEl.contentDocument;
  const targets = doc.querySelectorAll("[data-widget-id]");
  const instances = [];
  targets.forEach((el) => {
    const widgetId = el.getAttribute("data-widget-id");
    const entry = widgetsById?.[widgetId];
    if (!entry || !entry.widget) return;
    if (entry.widget.type !== "echarts") return;
    if (!el.style.height) el.style.height = "320px";
    const inst = echartsInstance.init(el);
    inst.setOption(buildOption(entry.widget, entry.rows || []), true);
    instances.push(inst);
  });
  return () => {
    instances.forEach((inst) => inst.dispose());
  };
}
