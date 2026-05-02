import assert from "node:assert/strict";
import test from "node:test";
import { renderTemplate, buildIframeDocument } from "./templateRenderer.js";

test("renderTemplate は {{widget:..}} を data-widget-id 付き div に置換する", () => {
  const html = '<div>chart: {{widget:w_chart1}}</div>';
  const result = renderTemplate(html);
  assert.match(result, /<div data-widget-id="w_chart1"/);
  assert.match(result, /class="nfb-dash-widget-target"/);
});

test("renderTemplate は {{value:queryId.col}} を行 0 の値で差し込む", () => {
  const html = "<p>合計: {{value:q1.total_amount}}</p>";
  const result = renderTemplate(html, {
    queryResults: { q1: [{ total_amount: 1234 }, { total_amount: 5678 }] },
  });
  assert.match(result, /合計: 1234/);
});

test("renderTemplate は {{value:queryId.col.N}} で N 行目を取得する", () => {
  const html = "<p>{{value:q1.col.1}}</p>";
  const result = renderTemplate(html, {
    queryResults: { q1: [{ col: "first" }, { col: "second" }] },
  });
  assert.match(result, /<p>second<\/p>/);
});

test("renderTemplate は {{value}} の値を HTML エスケープする (XSS 対策)", () => {
  const html = "<p>{{value:q1.danger}}</p>";
  const result = renderTemplate(html, {
    queryResults: { q1: [{ danger: '<script>alert("x")</script>' }] },
  });
  assert.doesNotMatch(result, /<script>/);
  assert.match(result, /&lt;script&gt;/);
  assert.match(result, /&quot;/);
});

test("renderTemplate は {{table:queryId}} を <table> として展開する", () => {
  const html = "<div>{{table:q1}}</div>";
  const result = renderTemplate(html, {
    queryResults: { q1: [{ day: "2026-03-01", total_amount: 100 }] },
  });
  assert.match(result, /<table/);
  assert.match(result, /<th>day<\/th>/);
  assert.match(result, /<th>total_amount<\/th>/);
  assert.match(result, /<td>2026-03-01<\/td>/);
  assert.match(result, /<td>100<\/td>/);
});

test("renderTemplate は {{table:..}} で空配列なら 'データなし' プレースホルダ", () => {
  const html = "{{table:q_empty}}";
  const result = renderTemplate(html, { queryResults: { q_empty: [] } });
  assert.match(result, /データなし/);
});

test("renderTemplate は {{param:..}} を差し込みエスケープする", () => {
  const html = "month={{param:month}}, name={{param:name}}";
  const result = renderTemplate(html, { params: { month: 3, name: "<x>" } });
  assert.match(result, /month=3/);
  assert.match(result, /name=&lt;x&gt;/);
});

test("renderTemplate は {{_NOW}} を ISO 8601 で差し込む", () => {
  const html = "<time>{{_NOW}}</time>";
  const result = renderTemplate(html);
  assert.match(result, /<time>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("renderTemplate は未知のトークンを空文字に置換する", () => {
  const html = "[{{unknown:foo}}][{{noprefix}}]";
  const result = renderTemplate(html);
  assert.equal(result, "[][]");
});

test("buildIframeDocument は <html> がない場合に最小ラッパを付ける", () => {
  const wrapped = buildIframeDocument("<p>hi</p>");
  assert.match(wrapped, /<!DOCTYPE html>/);
  assert.match(wrapped, /<html lang="ja">/);
  assert.match(wrapped, /<p>hi<\/p>/);
});

test("buildIframeDocument は既存の <html> を尊重する", () => {
  const original = "<!DOCTYPE html><html><body>kept</body></html>";
  assert.equal(buildIframeDocument(original), original);
});
