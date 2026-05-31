import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyncSummaryLines,
  buildSyncSummaryText,
  summarizeSyncSegments,
  buildSyncResultMarkdown,
  summarizeLinkSegments,
  renderBarChartHtml,
  buildLinkReportPrintHtml,
  buildSyncResultPrintHtml,
} from "./reportArtifacts.js";

const sampleSync = {
  mode: "apply",
  align: {
    forms: { aligned: 3, moved: 1, copiedExternal: 0, rekeyed: 2, errors: 1 },
    questions: { aligned: 1, moved: 0, copiedExternal: 1, rekeyed: 0, errors: 0 },
    dashboards: { aligned: 0, moved: 0, copiedExternal: 0, rekeyed: 0, errors: 0 },
  },
  orphans: {
    forms: { scanned: 5, registered: 2, invalid: 0 },
    questions: { scanned: 1, registered: 1, invalid: 0 },
    dashboards: { scanned: 0, registered: 0, invalid: 0 },
  },
  dedup: {
    forms: { groups: 1, survivors: 1, losers: 2 },
    questions: { groups: 0, survivors: 0, losers: 0 },
    dashboards: { groups: 0, survivors: 0, losers: 0 },
  },
  errors: [{ kind: "Form", name: "売上フォーム", id: "F1", folder: "01_forms/売上", reason: "物理ファイル未検出" }],
  invalidCandidates: [{ kind: "Question", relPath: "02_questions/ゴミ.json" }],
  duplicateCandidates: [{ kind: "Form", relPath: "01_forms/dup.json" }],
  trashedDuplicates: [],
  relink: { questions: { refsRelinked: 4 }, dashboards: { refsRelinked: 1 } },
  appliedDeleteInvalid: false,
  truncated: false,
};

test("buildSyncSummaryLines: カテゴリ別件数とエラー詳細を行にまとめる", () => {
  const lines = buildSyncSummaryLines(sampleSync);
  const text = buildSyncSummaryText(sampleSync);
  assert.equal(text, lines.join("\n"));
  assert.match(lines[0], /① 一致\(変更なし\): 4件/);   // 3+1+0
  assert.match(lines[0], /③ id再採用: 2件/);
  assert.match(lines[1], /⑤ 新規登録: フォーム 2 \/ Question 1 \/ Dashboard 0/);
  assert.ok(lines.some((l) => /参照の自動再リンク: Question 4 \/ Dashboard 1/.test(l)));
  assert.ok(lines.some((l) => /④ 要対応エラー.*1件/.test(l)));
  assert.ok(lines.some((l) => /⑥ 論理に結びつかない不正ファイル: 1件（未削除（候補））/.test(l)));
});

test("summarizeSyncSegments: 図表セグメントの値が集計と一致する", () => {
  const seg = summarizeSyncSegments(sampleSync);
  const byKey = Object.fromEntries(seg.map((s) => [s.key, s.value]));
  assert.equal(byKey.aligned, 4);
  assert.equal(byKey.rekeyed, 2);
  assert.equal(byKey.copiedExternal, 1);
  assert.equal(byKey.registered, 3);
  assert.equal(byKey.relinked, 5);
  assert.equal(byKey.dedupLosers, 2);
  assert.equal(byKey.errors, 1);
  assert.equal(byKey.invalid, 1);
  seg.forEach((s) => assert.match(s.color, /^#[0-9a-f]{6}$/i));
});

test("buildSyncResultMarkdown: 表・エラー全件・重複候補・不正候補を含む", () => {
  const md = buildSyncResultMarkdown(sampleSync, { generatedAt: "2026-06-01 10:00:00" });
  assert.match(md, /^# Nested Form Builder 同期/);
  assert.match(md, /\| ① 一致\(変更なし\) \| 4 \|/);
  assert.match(md, /## ④ 要対応エラー（全件）/);
  assert.match(md, /売上フォーム.*物理ファイル未検出/);
  assert.match(md, /## 同フォルダ同名 重複候補（全件）/);
  assert.match(md, /## ⑥ 不正ファイル候補（全件）/);
});

test("summarizeLinkSegments: stats から ok/auto/manual/external を取り出す", () => {
  const stats = { okLinks: 10, autoRelinkable: 3, brokenCandidates: 2, externalRefs: 5 };
  const seg = summarizeLinkSegments(stats);
  assert.deepEqual(seg.map((s) => s.value), [10, 3, 2, 5]);
  assert.deepEqual(seg.map((s) => s.key), ["ok", "auto", "manual", "external"]);
});

test("renderBarChartHtml: 最大値を 100% に正規化し各バーを描く", () => {
  const html = renderBarChartHtml([
    { label: "A", value: 5, color: "#27ae60" },
    { label: "B", value: 10, color: "#c0392b" },
    { label: "C", value: 0, color: "#7f8c8d" },
  ]);
  assert.match(html, /width:50%/);   // 5/10
  assert.match(html, /width:100%/);  // 10/10
  assert.match(html, /width:0%/);    // 0/10
  assert.match(html, /<div class="bar-value">10<\/div>/);
});

test("renderBarChartHtml: 全て 0 でも division by zero にならない", () => {
  const html = renderBarChartHtml([{ label: "A", value: 0, color: "#000000" }]);
  assert.match(html, /width:0%/);
});

test("buildLinkReportPrintHtml: 図表と Markdown 見出し・コードを HTML 化する", () => {
  const md = "# タイトル\n\n## 節\n\n- 項目1\n- 項目2\n\n```\ncode <here>\n```\n";
  const html = buildLinkReportPrintHtml(md, { files: 7, forms: 3, scannedLinks: 12, okLinks: 9, autoRelinkable: 2, brokenCandidates: 1, externalRefs: 0 });
  assert.match(html, /リンク状態（図示）/);
  assert.match(html, /<h1>タイトル<\/h1>/);
  assert.match(html, /<h2>節<\/h2>/);
  assert.match(html, /<li>項目1<\/li>/);
  assert.match(html, /<pre><code>/);
  assert.match(html, /code &lt;here&gt;/);   // エスケープされる
});

test("buildSyncResultPrintHtml: 図表とエラー全件を含み HTML エスケープする", () => {
  const html = buildSyncResultPrintHtml({
    mode: "apply",
    align: { forms: { aligned: 1 }, questions: {}, dashboards: {} },
    orphans: { forms: {}, questions: {}, dashboards: {} },
    dedup: { forms: {}, questions: {}, dashboards: {} },
    errors: [{ kind: "Form", name: "<b>名前</b>", id: "F1", folder: "", reason: "理由" }],
    invalidCandidates: [],
  });
  assert.match(html, /集計（図示）/);
  assert.match(html, /&lt;b&gt;名前&lt;\/b&gt;/);   // エスケープ
  assert.doesNotMatch(html, /<b>名前<\/b>/);
});
