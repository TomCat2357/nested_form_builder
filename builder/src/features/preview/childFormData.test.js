import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChildDataObject,
  distributeChildRecordsByPid,
  collectFormLinkFields,
  MAX_CHILD_RECORDS_PER_FIELD,
} from "./childFormData.js";

// 子フォーム schema（path-keyed data を id-keyed responses に戻して items を組む経路を通す）
const childSchema = [
  { id: "f_name", type: "text", label: "氏名" },
  { id: "f_age", type: "number", label: "年齢" },
];

const makeRecord = (id, pid, name, age) => ({
  id,
  "No.": id.replace(/\D/g, ""),
  pid,
  data: { "氏名": name, "年齢": age },
  dataUnixMs: {},
});

test("buildChildDataObject: メタ + 各子レコードの items を組む", () => {
  const obj = buildChildDataObject({
    childFormId: "fileABC",
    childFormName: "親/子フォーム",
    childFormUrl: "https://ex/exec?form=fileABC&pid=p1",
    childSchema,
    records: [makeRecord("c1", "p1", "山田", "20"), makeRecord("c2", "p1", "佐藤", "30")],
  });
  assert.equal(obj.childFormId, "fileABC");
  assert.equal(obj.childFormName, "親/子フォーム");
  assert.equal(obj.childFormUrl, "https://ex/exec?form=fileABC&pid=p1");
  assert.equal(obj.count, 2);
  assert.equal(obj.records.length, 2);
  assert.equal(obj.records[0].id, "c1");
  assert.equal(obj.records[0].no, "1");
  // items は { question, value, type } 形（buildRecordItems と同じ）
  const nameItem = obj.records[0].items.find((it) => it.question === "氏名");
  assert.ok(nameItem, "氏名 item should exist");
  assert.equal(nameItem.value, "山田");
  assert.ok(!("truncated" in obj));
});

test("buildChildDataObject: 空レコードは count 0 / records 空", () => {
  const obj = buildChildDataObject({ childFormId: "f", childSchema, records: [] });
  assert.equal(obj.count, 0);
  assert.deepEqual(obj.records, []);
});

test("buildChildDataObject: 上限超過で records を切り詰め truncated を立てる（count は総数維持）", () => {
  const many = [];
  for (let i = 0; i < MAX_CHILD_RECORDS_PER_FIELD + 5; i++) {
    many.push(makeRecord(`c${i}`, "p1", `名前${i}`, String(i)));
  }
  const obj = buildChildDataObject({ childFormId: "f", childSchema, records: many });
  assert.equal(obj.count, MAX_CHILD_RECORDS_PER_FIELD + 5);
  assert.equal(obj.records.length, MAX_CHILD_RECORDS_PER_FIELD);
  assert.equal(obj.truncated, true);
});

test("buildChildDataObject: 文字列メタは安全に空文字へ正規化", () => {
  const obj = buildChildDataObject({ records: [] });
  assert.equal(obj.childFormId, "");
  assert.equal(obj.childFormName, "");
  assert.equal(obj.childFormUrl, "");
});

test("distributeChildRecordsByPid: pid ごとに分配し、pid 無しは捨てる", () => {
  const map = distributeChildRecordsByPid([
    makeRecord("c1", "p1", "a", "1"),
    makeRecord("c2", "p2", "b", "2"),
    makeRecord("c3", "p1", "c", "3"),
    makeRecord("c4", "", "d", "4"),
  ]);
  assert.deepEqual(map.get("p1").map((r) => r.id), ["c1", "c3"]);
  assert.deepEqual(map.get("p2").map((r) => r.id), ["c2"]);
  assert.equal(map.has(""), false);
});

test("distributeChildRecordsByPid: 非配列は空 Map", () => {
  assert.equal(distributeChildRecordsByPid(null).size, 0);
  assert.equal(distributeChildRecordsByPid(undefined).size, 0);
});

test("collectFormLinkFields: childFormId/id を trim し、空は除外", () => {
  const out = collectFormLinkFields([
    { id: " fl1 ", type: "formLink", childFormId: " fileA ", childFormPath: "親/子A" },
    { id: "fl2", type: "formLink", childFormId: "   " }, // childFormId 空 → 除外
    { id: "   ", type: "formLink", childFormId: "fileB" }, // id 空 → 除外
    { id: "txt", type: "text", label: "氏名" }, // formLink 以外 → 除外
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "fl1");
  assert.equal(out[0].childFormId, "fileA");
  assert.equal(out[0].childFormName, "親/子A");
});

test("collectFormLinkFields: includeChildData の true/非true を反映", () => {
  const out = collectFormLinkFields([
    { id: "fl1", type: "formLink", childFormId: "fileA", includeChildData: true },
    { id: "fl2", type: "formLink", childFormId: "fileB", includeChildData: false },
    { id: "fl3", type: "formLink", childFormId: "fileC" },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out.find((f) => f.id === "fl1").includeChildData, true);
  assert.equal(out.find((f) => f.id === "fl2").includeChildData, false);
  assert.equal(out.find((f) => f.id === "fl3").includeChildData, false);
});

test("collectFormLinkFields: ネスト schema で path（pathSegments 連結）を組む", () => {
  const out = collectFormLinkFields([
    {
      id: "radio",
      type: "radio",
      label: "選択",
      options: [{ id: "o1", label: "はい" }],
      childrenByValue: {
        "はい": [
          { id: "flNested", type: "formLink", childFormId: "fileX", childFormPath: "子X" },
        ],
      },
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "flNested");
  // path は "|" 区切りの pathSegments。ネストしている＝複数セグメントになる。
  assert.ok(out[0].path.includes("/"), `path should be nested: ${out[0].path}`);
});
