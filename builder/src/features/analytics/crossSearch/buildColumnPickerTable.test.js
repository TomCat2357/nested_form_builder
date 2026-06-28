import test from "node:test";
import assert from "node:assert/strict";
import { buildColumnPickerTable } from "./buildColumnPickerTable.js";

const field = (label, type, isDisplayed, extra = {}) => ({
  id: `${label}-id`,
  label,
  type,
  isDisplayed,
  ...extra,
});

test("buildColumnPickerTable: 同一パスを 1 行に重ね、表示/非表示(グレー)/列なし を判定する", () => {
  const formA = {
    formId: "A",
    formName: "申込",
    schema: [
      field("氏名", "text", true),
      field("年齢", "number", true),
      field("メモ", "text", false), // 存在するが非表示
    ],
  };
  const formB = {
    formId: "B",
    formName: "問合せ",
    schema: [
      field("氏名", "text", true), // A と同名 → 同一行に重ねる
      field("メモ", "text", true), // B では表示 → 行になる。A では present(グレー)
    ],
  };

  const { forms, rows } = buildColumnPickerTable([formA, formB]);
  assert.deepEqual(forms, [
    { formId: "A", formName: "申込" },
    { formId: "B", formName: "問合せ" },
  ]);

  const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.deepEqual(byPath["氏名"].cells, { A: "displayed", B: "displayed" });
  assert.deepEqual(byPath["年齢"].cells, { A: "displayed", B: "absent" });
  assert.deepEqual(byPath["メモ"].cells, { A: "present", B: "displayed" });
  assert.deepEqual(byPath["メモ"].displayedFormIds, ["B"]);
  assert.deepEqual(byPath["メモ"].presentFormIds, ["A"]);
});

test("buildColumnPickerTable: 構造（ネスト）列はスラッシュ連結の path、label は末端セグメント", () => {
  const formA = {
    formId: "A",
    formName: "申込",
    schema: [
      {
        id: "g1",
        label: "連絡先",
        type: "group",
        children: [field("電話", "text", true)],
      },
    ],
  };
  const { rows } = buildColumnPickerTable([formA]);
  const row = rows.find((r) => r.path === "連絡先/電話");
  assert.ok(row);
  assert.deepEqual(row.segments, ["連絡先", "電話"]);
  assert.equal(row.label, "電話");
});

test("buildColumnPickerTable: アクション系の表示列（formLink / printTemplate）は候補から除外する", () => {
  const formA = {
    formId: "A",
    formName: "申込",
    schema: [
      field("氏名", "text", true),
      field("子フォーム", "formLink", true),
      field("帳票", "printTemplate", true),
    ],
  };
  const { rows } = buildColumnPickerTable([formA]);
  assert.deepEqual(rows.map((r) => r.path), ["氏名"]);
});
