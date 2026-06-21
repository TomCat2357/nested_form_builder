import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAdminEmailInput,
  buildMembershipFailMessage,
  formatAlignSummary,
  formatCopyResult,
  formatImportResult,
} from "./adminTabMessages.js";

test("normalizeAdminEmailInput: trim + 空要素除去で ; 連結", () => {
  assert.equal(normalizeAdminEmailInput(" a@x.com ; ; b@x.com ;"), "a@x.com;b@x.com");
  assert.equal(normalizeAdminEmailInput(""), "");
  assert.equal(normalizeAdminEmailInput(null), "");
});

test("buildMembershipFailMessage: 理由ごとの文面を出し分け", () => {
  assert.match(buildMembershipFailMessage({ reason: "missing_current_user_email" }), /ログインし直して/);
  assert.match(buildMembershipFailMessage({ userEmail: "u@x", reason: "not_member" }), /u@x.*管理者リストに含まれていません/s);
  assert.match(
    buildMembershipFailMessage({ userEmail: "u@x", reason: "group_fetch_failed", groupErrors: { "g@x": "403" } }),
    /・g@x: 403/,
  );
  // groupErrors 無しは「詳細不明」フォールバック
  assert.match(buildMembershipFailMessage({ reason: "group_fetch_failed" }), /（詳細不明）/);
  // 未知 reason は detail 優先、無ければ既定文
  assert.equal(buildMembershipFailMessage({ reason: "weird", detail: "X" }), "X");
  assert.match(buildMembershipFailMessage({ reason: "weird" }), /weird/);
});

test("formatAlignSummary: 件数行 + skipped + エラー上位3件 + ほか", () => {
  const align = {
    forms: { moved: 1, copiedExternal: 0, rekeyed: 0, aligned: 2, errors: 0 },
    questions: { skipped: true },
    dashboards: { moved: 0, copiedExternal: 0, rekeyed: 0, aligned: 0, errors: 1 },
    relinkedFiles: 3,
    errors: [
      { kind: "form", name: "A", folder: "01", reason: "r1" },
      { kind: "q", id: "id2", folder: "02", reason: "r2" },
      { kind: "d", name: "C", folder: "03", reason: "r3" },
      { kind: "d", name: "D", folder: "04", reason: "r4" },
    ],
  };
  const out = formatAlignSummary("ROOT", align);
  assert.match(out, /「ROOT」配下に標準フォルダ構成/);
  assert.match(out, /フォーム: 移動 1件/);
  assert.match(out, /Question: スキップ（標準フォルダが無効）/);
  assert.match(out, /Dashboard:.*エラー 1件/);
  assert.match(out, /参照リンク再構成: 3件/);
  assert.match(out, /エラー 4件:/);
  assert.match(out, /・\[form\] A（01）: r1/);
  assert.match(out, /…ほか 1件/);
});

test("formatCopyResult: appsScript 失敗時は理由を含む", () => {
  const out = formatCopyResult({
    summary: { forms: 2, questions: 1 },
    clearedLinks: 5,
    unresolvedQuestionLinks: 0,
    appsScriptCopied: false,
    appsScriptCopyError: "権限なし",
    message: "完了",
  });
  assert.match(out, /^完了/);
  assert.match(out, /appsscript 本体: コピーできませんでした（権限なし）/);
  assert.match(out, /forms: 2件/);
  assert.match(out, /クリアしたリンク: 5/);
  assert.match(out, /未解決のリンク.*: 0/);
});

test("formatCopyResult: appsScript 成功 / unresolved 未指定は 0", () => {
  const out = formatCopyResult({
    summary: {},
    clearedLinks: 0,
    appsScriptCopied: true,
    message: "OK",
  });
  assert.match(out, /appsscript 本体: コピーしました/);
  assert.match(out, /未解決のリンク.*: 0/);
});

test("formatCopyResult: unresolvedLinks を表示、無ければ unresolvedQuestionLinks にフォールバック", () => {
  const withTotal = formatCopyResult({
    summary: {}, clearedLinks: 0, unresolvedLinks: 3, unresolvedQuestionLinks: 1,
    appsScriptCopied: true, message: "OK",
  });
  assert.match(withTotal, /未解決のリンク.*: 3/, "3 種合算の unresolvedLinks を優先表示");

  const legacy = formatCopyResult({
    summary: {}, clearedLinks: 0, unresolvedQuestionLinks: 2,
    appsScriptCopied: true, message: "OK",
  });
  assert.match(legacy, /未解決のリンク.*: 2/, "旧版（unresolvedLinks 無し）は unresolvedQuestionLinks にフォールバック");
});

test("formatCopyResult: categories で未選択カテゴリは「除外」と表示し分ける", () => {
  const out = formatCopyResult({
    summary: { forms: 2, documents: 0, spreadsheets: 0 },
    categories: { forms: true, documents: false, spreadsheets: true },
    clearedLinks: 0,
    unresolvedQuestionLinks: 0,
    appsScriptCopied: true,
    message: "完了",
  });
  assert.match(out, /forms: 2件/);
  assert.match(out, /documents: 除外/, "未選択カテゴリは除外と表示");
  assert.match(out, /spreadsheets: 0件/, "選択済みで 0 件は件数表示（除外ではない）");
});

test("formatImportResult: 件数 + エラー上位3 + 末尾の自動整列案内", () => {
  const out = formatImportResult({
    imported: { forms: 2, questions: 0, dashboards: 1 },
    skipped: 3,
    errors: [
      { section: "forms", id: "f1", reason: "e1" },
      { section: "q", id: "q1", reason: "e2" },
      { section: "d", id: "d1", reason: "e3" },
      { section: "d", id: "d2", reason: "e4" },
    ],
  });
  assert.match(out, /フォーム: 2件/);
  assert.match(out, /スキップ（重複）: 3件/);
  assert.match(out, /エラー: 4件/);
  assert.match(out, /・\[forms\] f1: e1/);
  assert.match(out, /…ほか 1件/);
  assert.match(out, /次回保存時に標準フォルダへ自動整列・再リンク/);
});

test("formatImportResult: エラー無しでも案内行は付く", () => {
  const out = formatImportResult({ imported: {}, skipped: 0, errors: [] });
  assert.match(out, /フォーム: 0件/);
  assert.doesNotMatch(out, /エラー:/);
  assert.match(out, /自動整列・再リンク/);
});
