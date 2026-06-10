import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDashboardPayload } from "./dashboardEditorPayload.js";

test("buildDashboardPayload: 名前が空ならエラー", () => {
  assert.deepEqual(buildDashboardPayload({ dashboard: { name: "  " } }), {
    error: "ダッシュボード名を入力してください。",
  });
  assert.deepEqual(buildDashboardPayload({ dashboard: {} }), {
    error: "ダッシュボード名を入力してください。",
  });
});

test("buildDashboardPayload: 名前/説明をトリムし schemaVersion=2", () => {
  const out = buildDashboardPayload({
    dashboard: { name: "  D1  ", description: "  desc  ", folder: "a/b" },
    dashboardId: "id1",
    now: 12345,
  });
  assert.equal(out.payload.name, "D1");
  assert.equal(out.payload.description, "desc");
  assert.equal(out.payload.schemaVersion, 2);
  assert.equal(out.payload.id, "id1");
  assert.equal(out.payload.modifiedAt, 12345);
});

test("buildDashboardPayload: 既存 id を優先し dashboardId にフォールバック", () => {
  assert.equal(
    buildDashboardPayload({ dashboard: { name: "D", id: "real" }, dashboardId: "url" }).payload.id,
    "real"
  );
  assert.equal(
    buildDashboardPayload({ dashboard: { name: "D" }, dashboardId: "url" }).payload.id,
    "url"
  );
});

test("buildDashboardPayload: question カードから stale questionName を剥がす", () => {
  const out = buildDashboardPayload({
    dashboard: {
      name: "D",
      cards: [
        { id: "c1", type: "chart", questionId: "Q1", questionName: "旧", title: "t" },
        { id: "c2", type: "message", text: "hi", questionName: "保持されない種別" },
        { id: "c3", type: "chart" }, // questionId なし → そのまま
      ],
    },
    now: 1,
  });
  const [c1, c2, c3] = out.payload.cards;
  assert.ok(!("questionName" in c1));
  assert.equal(c1.questionId, "Q1");
  assert.equal(c1.title, "t");
  // message カードと questionId 無しカードは無加工で素通し
  assert.equal(c2.type, "message");
  assert.equal(c2.questionName, "保持されない種別");
  assert.equal(c3.type, "chart");
});

test("buildDashboardPayload: question カードに questionPath を冗長保存する", () => {
  const out = buildDashboardPayload({
    dashboard: {
      name: "D",
      cards: [
        { id: "c1", type: "chart", questionId: "Q1", questionName: "旧", questionPath: "旧/パス" },
        { id: "c2", type: "chart", questionId: "MISSING" },
      ],
    },
    questions: [{ id: "Q1", folder: "営業", name: "集計" }],
    now: 1,
  });
  const [c1, c2] = out.payload.cards;
  assert.equal(c1.questionPath, "営業/集計", "解決できた id は論理パスを stamp");
  assert.ok(!("questionName" in c1));
  assert.equal(c2.questionPath, "", "未解決 id は空文字");
});

test("buildDashboardPayload: cards 未定義でも空配列", () => {
  const out = buildDashboardPayload({ dashboard: { name: "D" }, now: 1 });
  assert.deepEqual(out.payload.cards, []);
});
