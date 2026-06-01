/**
 * 管理タブの「同期（フォルダ走査）結果」と「構成レポート（リンク診断）」を
 * 画面表示・.md ダウンロード・PDF 印刷（ブラウザの印刷→PDF 保存）で共有するための
 * 純粋なアーティファクト生成ヘルパー群。
 *
 * - 同期結果: 構造化レスポンス r から要約テキスト / Markdown / 図表セグメントを作る。
 * - リンク診断: GAS の Markdown と stats から、図表セグメントと印刷用 HTML を作る。
 * - printHtmlDocument: 整形済み HTML を別ウィンドウで開き、印刷（PDF 保存）させる。
 *
 * UI（React）と印刷 HTML の両方が summarize*Segments を共有することで、画面の図表と
 * PDF の図表が常に一致する。
 */

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const SEVERITY_COLORS = {
  ok: "#27ae60",
  auto: "#2980b9",
  manual: "#c0392b",
  external: "#7f8c8d",
  neutral: "#34495e",
  info: "#16a085",
};

// ---------------------------------------------------------------------------
// 同期（フォルダ走査）結果
// ---------------------------------------------------------------------------

const alignSum = (r, key) => ["forms", "questions", "dashboards"]
  .reduce((acc, k) => acc + ((r?.align?.[k]?.[key]) || 0), 0);
const orphanReg = (r, k) => (r?.orphans?.[k]?.registered) || 0;
const dedupSum = (r, key) => ["forms", "questions", "dashboards"]
  .reduce((acc, k) => acc + ((r?.dedup?.[k]?.[key]) || 0), 0);
const fidDedupRemovedSum = (r) => ["forms", "questions", "dashboards"]
  .reduce((acc, k) => acc + ((r?.fileIdDedup?.[k]?.removed) || 0), 0);

// 整合同期の結果（6 ケース＋重複整理＋再リンク）を人間可読な行配列にまとめる。
export const buildSyncSummaryLines = (r) => {
  const lines = [
    `① 一致(変更なし): ${alignSum(r, "aligned")}件 / ② 物理移動: ${alignSum(r, "moved")}件 / ② 外部コピー取込: ${alignSum(r, "copiedExternal")}件 / ③ id再採用: ${alignSum(r, "rekeyed")}件`,
    `⑤ 新規登録: フォーム ${orphanReg(r, "forms")} / Question ${orphanReg(r, "questions")} / Dashboard ${orphanReg(r, "dashboards")}`,
  ];
  if (r?.relink && (r.relink.questions || r.relink.dashboards)) {
    const q = r.relink.questions || {};
    const d = r.relink.dashboards || {};
    lines.push(`参照の自動再リンク: Question ${q.refsRelinked || 0} / Dashboard ${d.refsRelinked || 0} 参照`);
  }
  const fidDedupRemoved = fidDedupRemovedSum(r);
  if (fidDedupRemoved > 0) {
    lines.push(`同一fileIdの論理パス重複整理: 余りの論理パス ${fidDedupRemoved}件を登録簿から除去（物理ファイルは共有のため保持）`);
  }
  const dupLosers = dedupSum(r, "losers");
  if (dupLosers > 0) {
    const trashed = (r?.trashedDuplicates || []).length;
    lines.push(`同フォルダ同名 重複整理: 余り ${dupLosers}件（${trashed > 0 ? `ゴミ箱へ移動済み ${trashed}件` : "未削除（候補）"}）`);
  }
  const errs = r?.errors || [];
  if (errs.length) {
    lines.push(`④ 要対応エラー（物理ファイル未検出・自動修復不可）: ${errs.length}件`);
    errs.slice(0, 8).forEach((e) => lines.push(`・[${e.kind}] ${e.name || e.id}（${e.folder || "(直下)"}）: ${e.reason}`));
    if (errs.length > 8) lines.push("…ほか");
  }
  const inv = r?.invalidCandidates || [];
  if (inv.length) {
    lines.push(`⑥ 論理に結びつかない不正ファイル: ${inv.length}件（${r?.appliedDeleteInvalid ? "ゴミ箱へ移動済み" : "未削除（候補）"}）`);
  }
  if (r?.truncated) lines.push("⚠ 実行時間の安全弁で打ち切りました。再実行してください。");
  return lines;
};

export const buildSyncSummaryText = (r) => buildSyncSummaryLines(r).join("\n");

// 図表（横棒）用のセグメント。画面の図と PDF の図で共有する。
export const summarizeSyncSegments = (r) => [
  { key: "aligned", label: "① 一致(変更なし)", value: alignSum(r, "aligned"), color: SEVERITY_COLORS.ok },
  { key: "moved", label: "② 物理移動", value: alignSum(r, "moved"), color: SEVERITY_COLORS.info },
  { key: "copiedExternal", label: "② 外部コピー取込", value: alignSum(r, "copiedExternal"), color: SEVERITY_COLORS.info },
  { key: "rekeyed", label: "③ id再採用", value: alignSum(r, "rekeyed"), color: SEVERITY_COLORS.auto },
  { key: "registered", label: "⑤ 新規登録", value: orphanReg(r, "forms") + orphanReg(r, "questions") + orphanReg(r, "dashboards"), color: SEVERITY_COLORS.neutral },
  { key: "relinked", label: "参照の再リンク", value: ((r?.relink?.questions?.refsRelinked) || 0) + ((r?.relink?.dashboards?.refsRelinked) || 0), color: SEVERITY_COLORS.auto },
  { key: "fileIdDedup", label: "同fileId論理パス整理", value: fidDedupRemovedSum(r), color: SEVERITY_COLORS.external },
  { key: "dedupLosers", label: "重複整理(余り)", value: dedupSum(r, "losers"), color: SEVERITY_COLORS.external },
  { key: "errors", label: "④ 要対応エラー", value: (r?.errors || []).length, color: SEVERITY_COLORS.manual },
  { key: "invalid", label: "⑥ 不正ファイル", value: (r?.invalidCandidates || []).length, color: SEVERITY_COLORS.manual },
];

// 同期結果の Markdown（ダウンロード用）。
export const buildSyncResultMarkdown = (r, { generatedAt } = {}) => {
  const md = [];
  md.push("# Nested Form Builder 同期（フォルダ走査）結果");
  md.push("");
  if (generatedAt) md.push(`- 生成時刻: ${generatedAt}`);
  md.push(`- モード: ${r?.mode || "dryRun"}`);
  md.push("");
  md.push("## 集計");
  md.push("");
  md.push("| 区分 | 件数 |");
  md.push("| --- | ---: |");
  summarizeSyncSegments(r).forEach((s) => md.push(`| ${s.label} | ${s.value} |`));
  md.push("");
  md.push("## 詳細");
  md.push("");
  buildSyncSummaryLines(r).forEach((line) => md.push(`- ${line.replace(/^・/, "  - ")}`));
  md.push("");
  const errs = r?.errors || [];
  if (errs.length) {
    md.push("## ④ 要対応エラー（全件）");
    md.push("");
    errs.forEach((e) => md.push(`- [${e.kind}] ${e.name || e.id}（${e.folder || "(直下)"}）: ${e.reason}`));
    md.push("");
  }
  const dups = r?.duplicateCandidates || [];
  if (dups.length) {
    md.push("## 同フォルダ同名 重複候補（全件）");
    md.push("");
    dups.forEach((f) => md.push(`- [${f.kind}] ${f.relPath}`));
    md.push("");
  }
  const inv = r?.invalidCandidates || [];
  if (inv.length) {
    md.push("## ⑥ 不正ファイル候補（全件）");
    md.push("");
    inv.forEach((f) => md.push(`- [${f.kind}] ${f.relPath}`));
    md.push("");
  }
  return md.join("\n");
};

// ---------------------------------------------------------------------------
// 構成レポート（リンク診断）
// ---------------------------------------------------------------------------

// stats（GAS の nfbBuildLinkReport が返す集計）から図表セグメントを作る。
export const summarizeLinkSegments = (stats = {}) => [
  { key: "ok", label: "問題なし（構成内）", value: stats.okLinks || 0, color: SEVERITY_COLORS.ok },
  { key: "auto", label: "自動再リンク可（同期で修復）", value: stats.autoRelinkable || 0, color: SEVERITY_COLORS.auto },
  { key: "manual", label: "要手動対応", value: stats.brokenCandidates || 0, color: SEVERITY_COLORS.manual },
  { key: "external", label: "外部参照（未検査）", value: stats.externalRefs || 0, color: SEVERITY_COLORS.external },
];

// ---------------------------------------------------------------------------
// 図表（横棒）HTML
// ---------------------------------------------------------------------------

export const renderBarChartHtml = (segments) => {
  const max = Math.max(1, ...segments.map((s) => s.value || 0));
  const rows = segments.map((s) => {
    const pct = Math.round(((s.value || 0) / max) * 100);
    return (
      `<div class="bar-row">` +
      `<div class="bar-label">${escapeHtml(s.label)}</div>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${s.color}"></div></div>` +
      `<div class="bar-value">${s.value || 0}</div>` +
      `</div>`
    );
  });
  return `<div class="bar-chart">${rows.join("")}</div>`;
};

// 最小の Markdown→HTML（見出し / 箇条書き / コードフェンス）。リンク診断 PDF を読みやすくする用途。
const markdownToHtml = (markdown) => {
  const lines = String(markdown || "").split("\n");
  const out = [];
  let inList = false;
  let inCode = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of lines) {
    const line = raw;
    if (/^```/.test(line)) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { closeList(); out.push("<pre><code>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${escapeHtml(h[2])}</h${h[1].length}>`); continue; }
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${escapeHtml(li[1])}</li>`); continue; }
    closeList();
    if (line.trim() === "") { out.push(""); continue; }
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (inCode) out.push("</code></pre>");
  closeList();
  return out.join("\n");
};

const PRINT_CSS = `
* { box-sizing: border-box; }
body { font-family: "Segoe UI", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif; color: #222; margin: 24px; line-height: 1.6; }
h1 { font-size: 22px; border-bottom: 2px solid #2c3e50; padding-bottom: 6px; }
h2 { font-size: 17px; margin-top: 22px; border-left: 4px solid #2c3e50; padding-left: 8px; }
h3 { font-size: 14px; margin-top: 16px; }
h4 { font-size: 13px; margin-top: 12px; color: #555; }
ul { margin: 6px 0 6px 0; padding-left: 22px; }
li { margin: 2px 0; }
p { margin: 6px 0; }
pre { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 10px; overflow-x: auto; }
code { font-family: "Consolas", "Courier New", monospace; font-size: 12px; }
.bar-chart { margin: 14px 0 20px 0; }
.bar-row { display: flex; align-items: center; gap: 10px; margin: 5px 0; }
.bar-label { flex: 0 0 220px; font-size: 13px; }
.bar-track { flex: 1; background: #ecf0f1; border-radius: 4px; height: 18px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; min-width: 2px; }
.bar-value { flex: 0 0 48px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.meta { color: #666; font-size: 12px; }
@media print { body { margin: 0; } @page { margin: 16mm; } }
`;

// 整形済み HTML 本文を別ウィンドウで開き、印刷（ブラウザの「PDF として保存」）させる。
// ポップアップがブロックされた場合は例外を投げる（呼び出し側でアラート）。
//
// 重要: このソースはシングルファイル化された React バンドルのインライン `<script type="module">`
// 要素内に丸ごと同梱される。そのため `<script>` / `<style>` / `<head>` / `<body>` / `<html>` などの
// 構造タグ（開始・終了とも）を **文字列リテラルとして書いてはいけない**。書くと dist/index.html の
// インライン script 内にその部分文字列が現れ、doGet の HtmlService.createHtmlOutput() 往復（再パース）で
// GAS のパーサが入れ子を誤認し「形式が正しくない HTML コンテンツ」で配信全体が落ちる
// （あるいは script 終了タグなら本体 script を途中で閉じて生テキスト化する）。
// 文字列連結はミニファイ時に畳み込まれて結局リテラルになるため回避策にならない。
// よって印刷用ドキュメントは DOM API（createElement / textContent / innerHTML）だけで組み立て、
// 構造タグのリテラルがソースに一切現れないようにする。印刷トリガーも埋め込みスクリプトを使わず opener 側から呼ぶ。
export const printHtmlDocument = (bodyHtml, title) => {
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("ポップアップがブロックされました。印刷（PDF）にはポップアップを許可してください。");
  }
  // window.open("") の about:blank には既に空の文書ツリーがあるので、document.write の HTML 文字列ではなく
  // DOM 操作で中身を入れる（上記コメントの理由で構造タグのリテラルをソースに残さないため）。
  const doc = win.document;
  doc.title = title || "";
  const style = doc.createElement("style");
  style.textContent = PRINT_CSS;
  doc.head.appendChild(style);
  doc.body.innerHTML = bodyHtml;
  // 別ウィンドウの描画完了後に opener から印刷を起動する（インライン script を使わない）。
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch (_) {
      // ポップアップが既に閉じられている等は無視（利用者が手動で印刷できる）。
    }
  }, 200);
};

// 同期結果の印刷用 HTML 本文。
export const buildSyncResultPrintHtml = (r, { generatedAt } = {}) => {
  const parts = [];
  parts.push(`<h1>同期（フォルダ走査）結果</h1>`);
  parts.push(`<p class="meta">モード: ${escapeHtml(r?.mode || "dryRun")}${generatedAt ? ` / 生成時刻: ${escapeHtml(generatedAt)}` : ""}</p>`);
  parts.push(`<h2>集計（図示）</h2>`);
  parts.push(renderBarChartHtml(summarizeSyncSegments(r)));
  parts.push(`<h2>詳細</h2>`);
  parts.push("<ul>" + buildSyncSummaryLines(r).map((l) => `<li>${escapeHtml(l)}</li>`).join("") + "</ul>");
  const errs = r?.errors || [];
  if (errs.length) {
    parts.push(`<h2>④ 要対応エラー（全件）</h2>`);
    parts.push("<ul>" + errs.map((e) => `<li>[${escapeHtml(e.kind)}] ${escapeHtml(e.name || e.id)}（${escapeHtml(e.folder || "(直下)")}）: ${escapeHtml(e.reason)}</li>`).join("") + "</ul>");
  }
  return parts.join("\n");
};

// リンク診断レポートの印刷用 HTML 本文（図表＋Markdown 本文）。
export const buildLinkReportPrintHtml = (markdown, stats = {}) => {
  const parts = [];
  parts.push(`<h1>構成レポート（リンク診断）</h1>`);
  parts.push(`<p class="meta">ファイル ${stats.files || 0} 件 / フォーム ${stats.forms || 0} / Question ${stats.questions || 0} / Dashboard ${stats.dashboards || 0} / 検査リンク ${stats.scannedLinks || 0}</p>`);
  parts.push(`<h2>リンク状態（図示）</h2>`);
  parts.push(renderBarChartHtml(summarizeLinkSegments(stats)));
  parts.push(`<h2>レポート本文</h2>`);
  parts.push(markdownToHtml(markdown));
  return parts.join("\n");
};
