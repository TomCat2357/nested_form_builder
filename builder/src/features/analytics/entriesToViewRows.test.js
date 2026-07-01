import assert from "node:assert/strict";
import test from "node:test";
import { entriesToViewTableRows, buildLiveViewRow } from "./entriesToViewRows.js";
import { collectResponses } from "../../core/collect.js";

const form = {
  id: "f_x",
  schema: [
    { id: "f_dt", type: "date", label: "受付日" },
    { id: "f_dtm", type: "datetime", label: "受付時刻" },
    {
      id: "f_grp",
      type: "group",
      label: "基本情報",
      children: [
        { id: "f_ku", type: "text", label: "区" },
        { id: "f_amt", type: "number", label: "金額" },
      ],
    },
    {
      id: "f_radio",
      type: "radio",
      label: "性別",
      options: [{ label: "男" }, { label: "女" }, { label: "その他" }],
    },
    {
      id: "f_chk",
      type: "checkboxes",
      label: "希望",
      options: [{ label: "電話" }, { label: "メール" }, { label: "郵送" }],
    },
    {
      id: "f_sel",
      type: "select",
      label: "都道府県",
      options: [{ label: "東京都" }, { label: "大阪府" }],
    },
  ],
};

const baseEntry = {
  id: "01HX0000000000000000000001",
  "No.": 7,
  createdAt: "2025-04-01_10:20:30",
  modifiedAt: "2025-04-02_11:22:33",
  createdBy: "alice@example.com",
  modifiedBy: "bob@example.com",
  deletedAt: "",
  deletedBy: "",
};

// buildLiveViewRow: 置換 full-query の `_form` 現レコード行を「入力中のライブ値」で上書きするための
// 単一 view 行。collectResponses → entriesToViewTableRows を再利用するのでキャッシュ行と同形状。
// 実運用と同じく message コンテナ配下のネスト項目（例: 許可処分情報/処分の種類）を検証する。
const liveTestForm = {
  id: "f_live",
  schema: [
    { id: "f_dt2", type: "date", label: "受付日" },
    {
      id: "f_msg",
      type: "message",
      label: "許可処分情報",
      children: [
        { id: "f_kind", type: "radio", label: "処分の種類", options: [{ label: "許可" }, { label: "不許可" }] },
      ],
    },
    { id: "f_amt2", type: "number", label: "金額" },
  ],
};

test("buildLiveViewRow: 入力中レコードを 1 件の view 行へ（collectResponses → entriesToViewTableRows で同形状）", () => {
  const responses = { f_dt2: "2025-04-15", f_kind: "許可", f_amt2: "1500" };
  const liveEntry = { id: "REC_LIVE", "No.": 3, data: collectResponses(liveTestForm.schema, responses) };
  const row = buildLiveViewRow(liveTestForm, liveEntry);
  assert.ok(row);
  assert.equal(row.id, "REC_LIVE");
  assert.equal(row["No_"], 3);
  // 置換 `{{SELECT [許可処分情報/処分の種類] FROM _form WHERE [id]=_id}}` が参照する列。
  assert.equal(row["許可処分情報__処分の種類"], "許可");
  assert.equal(row["金額"], 1500);
  assert.equal(typeof row["金額"], "number");
  assert.equal(row["受付日"], "2025-04-15");
});

test("buildLiveViewRow: form / liveEntry が無ければ null", () => {
  assert.equal(buildLiveViewRow(liveTestForm, null), null);
  assert.equal(buildLiveViewRow(null, { id: "x", data: {} }), null);
});

// 統一契約: fileUpload 列は view 行でも「保存 JSON 文字列」を素通しする（素参照=JSON、
// FILE_*/FOLDER_* UDF がこれを parse）。全経路で同一値になることの土台。
test("fileUpload 列は保存 JSON 文字列を素通しする（統一契約）", () => {
  const uploadForm = { id: "f_u", schema: [{ id: "f_up", type: "fileUpload", label: "添付" }] };
  const responses = { f_up: [{ name: "a.xlsx", driveFileId: "ID1", driveFileUrl: "https://drive/a" }] };
  const data = collectResponses(uploadForm.schema, responses, {
    fileUploadFolderUrls: { f_up: "https://drive/folder" },
    fileUploadFolderNames: { f_up: "record_01" },
  });
  const row = buildLiveViewRow(uploadForm, { id: "REC", "No.": 1, data });
  // view 行の値 === 保存セルの文字列（そのまま）
  assert.equal(row["添付"], data["添付"]);
  const parsed = JSON.parse(row["添付"]);
  assert.equal(parsed.folderName, "record_01");
  assert.equal(parsed.files[0].name, "a.xlsx");
});

test("radio: 保存ラベルを親列に素通し、option 列は出さない", () => {
  const entry = {
    ...baseEntry,
    data: { "性別": "男" },
  };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["性別"], "男");
  // option 真偽値列は出ない
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "性別__男"));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "性別__女"));
});

test("radio: data[path] にラベル直書きならそれを採用", () => {
  const entry = {
    ...baseEntry,
    data: { "性別": "女" }, // 新形式：選択ラベルが直接入る
  };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["性別"], "女");
});

test("radio: 何も選択されていなければ空文字", () => {
  const entry = { ...baseEntry, data: {} };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["性別"], "");
});

test("checkboxes: 保存済み codec 連結文字列を素通し", () => {
  const entry = {
    ...baseEntry,
    data: { "希望": "電話,メール" },
  };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["希望"], "電話,メール");
  // ラベル内カンマ（エスケープ付き）もそのまま保持（MV_EQ が codec で復元する）
  const entry2 = {
    ...baseEntry,
    data: { "希望": "電話,郵送" },
  };
  const [row2] = entriesToViewTableRows([entry2], form);
  assert.equal(row2["希望"], "電話,郵送");
});

test("select: 保存ラベルを素通し", () => {
  const entry = {
    ...baseEntry,
    data: { "都道府県": "大阪府" },
  };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["都道府県"], "大阪府");
});

test("number: 文字列でも Number に強制", () => {
  const entry = {
    ...baseEntry,
    data: { "基本情報/金額": "1500" },
  };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["基本情報__金額"], 1500);
  assert.equal(typeof row["基本情報__金額"], "number");
});

test("text: data[path] を素通し", () => {
  const entry = { ...baseEntry, data: { "基本情報/区": "東区" } };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["基本情報__区"], "東区");
});

test("date: canonical 形式に整形", () => {
  const entry = { ...baseEntry, data: { "受付日": "2025-04-15" } };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["受付日"], "2025-04-15");
});

test("datetime: canonical 形式に整形（旧 ISO Z でも吸収）", () => {
  const entry = { ...baseEntry, data: { "受付時刻": "2025-04-15T10:20:30.000Z" } };
  const [row] = entriesToViewTableRows([entry], form);
  // datetime は "YYYY-MM-DD_HH:mm:ss.SSS"（JST、ms までゼロ埋め）。
  assert.match(row["受付時刻"], /^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}:\d{2}\.\d{3}$/);
});

test("メタ列が含まれる", () => {
  const entry = { ...baseEntry, data: {} };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row.id, baseEntry.id);
  assert.equal(row["No_"], 7);
  // createdAt / modifiedAt は既存の旧形式入力を受け入れて canonical (.SSS 付き) に正規化される
  assert.match(row.createdAt, /^2025-04-01_10:20:30(\.\d{3})?$/);
  assert.match(row.modifiedAt, /^2025-04-02_11:22:33(\.\d{3})?$/);
  assert.equal(row.createdBy, "alice@example.com");
  assert.equal(row.modifiedBy, "bob@example.com");
});

test("pid: 親レコード ID をメタ列として露出（親子 JOIN 用）", () => {
  const entry = { ...baseEntry, pid: "01HX0000000000000000000PARENT", data: {} };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row.pid, "01HX0000000000000000000PARENT");
});

test("pid: 欠落時は空文字（id/No_ と同じ既存ポリシー）", () => {
  const entry = { ...baseEntry, data: {} }; // pid 未設定
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row.pid, "");
});

test("option 真偽値列はそもそも row に出さない（data 形式との違い）", () => {
  const entry = {
    ...baseEntry,
    data: {
      "性別/男": "●",
      "希望/電話": "●",
      "希望/メール": "●",
      "都道府県/東京都": "●",
    },
  };
  const [row] = entriesToViewTableRows([entry], form);
  // 親列のみが存在し、option suffix 列は存在しない
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "性別__男"));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "希望__電話"));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "希望__メール"));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "都道府県__東京都"));
});

test("値が無いフィールドは null で初期化（SELECT * で schema 全列を返すため）", () => {
  const entry = { ...baseEntry, data: {} };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row["受付日"], null);
  assert.equal(row["基本情報__区"], null);
  assert.equal(row["基本情報__金額"], null);
  // radio/checkboxes/select は空文字（"" は collectDirectOptionLabels の自然な出力）
  assert.equal(row["性別"], "");
  assert.equal(row["希望"], "");
  assert.equal(row["都道府県"], "");
});

test("複数 entries を順序保証で返す", () => {
  const entries = [
    { ...baseEntry, id: "A", data: { "基本情報/区": "東区" } },
    { ...baseEntry, id: "B", data: { "基本情報/区": "西区" } },
  ];
  const rows = entriesToViewTableRows(entries, form);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "A");
  assert.equal(rows[0]["基本情報__区"], "東区");
  assert.equal(rows[1].id, "B");
  assert.equal(rows[1]["基本情報__区"], "西区");
});

test("_row: 入力順 1-based で付与（クエリ内 SELECT/WHERE で参照可能）", () => {
  const entries = [
    { ...baseEntry, id: "A", data: {} },
    { ...baseEntry, id: "B", data: {} },
    { ...baseEntry, id: "C", data: {} },
  ];
  const rows = entriesToViewTableRows(entries, form);
  assert.equal(rows[0]._row, 1);
  assert.equal(rows[1]._row, 2);
  assert.equal(rows[2]._row, 3);
});

test("_row: ユーザー定義の _row 列があってもメタ列同様後勝ちで上書きされる", () => {
  const entry = { ...baseEntry, data: { _row: "ユーザー入力" } };
  const [row] = entriesToViewTableRows([entry], form);
  assert.equal(row._row, 1);
});

test("空配列 / null / undefined", () => {
  assert.deepEqual(entriesToViewTableRows([], form), []);
  assert.deepEqual(entriesToViewTableRows(null, form), []);
  assert.deepEqual(entriesToViewTableRows(undefined, form), []);
});

test("form が無くてもメタ列入りの行は返る（fieldInfos 空）", () => {
  const entry = { ...baseEntry, data: { "x": "y" } };
  const rows = entriesToViewTableRows([entry], null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, baseEntry.id);
  assert.equal(rows[0]["No_"], 7);
  // データ列は schema 走査なしなので出ない
  assert.ok(!Object.prototype.hasOwnProperty.call(rows[0], "x"));
});
