import assert from "node:assert/strict";
import test from "node:test";
import { buildFileUploadEntry, collectResponses, sortResponses, buildDataValueMap, parseFileUploadStorage, serializeFileUploadValue } from "./collect.js";

test("collectResponses は fileUpload セルに論理パス folderName を同梱し、parse で往復できる", () => {
  const schema = [{ id: "u", type: "fileUpload", label: "添付" }];
  const responses = { u: [{ name: "a.pdf", driveFileId: "ID1", driveFileUrl: "https://drive/ID1" }] };
  const out = collectResponses(schema, responses, {
    fileUploadFolderUrls: { u: "https://drive.google.com/drive/folders/F1" },
    fileUploadFolderNames: { u: "record_01_abcd" },
  });
  const parsed = parseFileUploadStorage(out["添付"]);
  assert.equal(parsed.folderName, "record_01_abcd");
  assert.equal(parsed.folderUrl, "https://drive.google.com/drive/folders/F1");
  assert.deepEqual(parsed.files, [{ name: "a.pdf", driveFileId: "ID1", driveFileUrl: "https://drive/ID1" }]);
});

test("collectResponses は folderUrl が空でも folderName だけでオブジェクト形を保つ（コピー後の論理パス保持）", () => {
  const schema = [{ id: "u", type: "fileUpload", label: "添付" }];
  const responses = { u: [{ name: "a.pdf", driveFileId: "", driveFileUrl: "" }] };
  const out = collectResponses(schema, responses, {
    fileUploadFolderNames: { u: "record_01_abcd" },
  });
  const parsed = parseFileUploadStorage(out["添付"]);
  assert.equal(parsed.folderName, "record_01_abcd");
  assert.equal(parsed.folderUrl, "");
});

test("parseFileUploadStorage は folderName を持たない旧セル（配列形）でも空 folderName を返す", () => {
  const parsed = parseFileUploadStorage(JSON.stringify([{ name: "a.pdf", driveFileId: "ID1", driveFileUrl: "u" }]));
  assert.equal(parsed.folderName, "");
  assert.equal(parsed.files.length, 1);
});

// 統一契約のパリティ: テンプレ行が使う storageValue（serializeFileUploadValue）は
// 保存セル（collectResponses）とバイト一致する（driveFileId 込み・3 ケース）。
test("serializeFileUploadValue は collectResponses の保存セルとバイト一致する", () => {
  const schema = [{ id: "u", type: "fileUpload", label: "添付" }];
  const files = [
    { name: "a.pdf", driveFileId: "ID1", driveFileUrl: "https://drive/ID1" },
    { name: "b.pdf", driveFileId: "ID2", driveFileUrl: "https://drive/ID2" },
  ];

  // (1) フォルダあり（オブジェクト形）
  const outWithFolder = collectResponses(schema, { u: files }, {
    fileUploadFolderUrls: { u: "https://drive/F1" },
    fileUploadFolderNames: { u: "record_01" },
  });
  assert.equal(
    serializeFileUploadValue(files, "https://drive/F1", "record_01"),
    outWithFolder["添付"],
  );

  // (2) フォルダなし（裸配列形）
  const outNoFolder = collectResponses(schema, { u: files }, {});
  assert.equal(serializeFileUploadValue(files, "", ""), outNoFolder["添付"]);

  // (3) ファイル空＋フォルダのみ（オブジェクト形・files:[]）
  const outEmptyWithFolder = collectResponses(schema, { u: [] }, {
    fileUploadFolderNames: { u: "record_02" },
  });
  assert.equal(serializeFileUploadValue([], "", "record_02"), outEmptyWithFolder["添付"]);
});

test("buildDataValueMap: 選択肢はフィールド 1 列のラベル（複数選択は表示区切り ', '）", () => {
  const schema = [
    { id: "g", type: "radio", label: "性別", options: [{ id: "m", label: "男" }, { id: "f", label: "女" }] },
    {
      id: "t",
      type: "checkboxes",
      label: "種別",
      options: [{ id: "a", label: "申請" }, { id: "b", label: "契約" }],
    },
  ];
  const map = buildDataValueMap(schema, { g: "男", t: ["申請", "契約"] });
  assert.equal(map["性別"], "男");
  assert.equal(map["種別"], "申請, 契約");
  // 未選択フィールドはキー自体を持たない（false 埋めは廃止）
  assert.equal(Object.prototype.hasOwnProperty.call(map, "性別/男"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(map, "種別/申請"), false);
});

test("buildDataValueMap: text/number/date は canonical 値（number は数値型）", () => {
  const schema = [
    { id: "n", type: "text", label: "氏名" },
    { id: "num", type: "number", label: "金額" },
    { id: "d", type: "date", label: "日付" },
  ];
  const map = buildDataValueMap(schema, { n: "山田", num: "1000", d: "2025-05-25" });
  assert.equal(map["氏名"], "山田");
  assert.equal(map["金額"], 1000);
  assert.equal(map["日付"], "2025-05-25");
});

test("collectResponses: time フィールドは timePrecision に応じた幅で正規化保存する", () => {
  const run = (precision) => {
    const schema = [{ id: "q_t", type: "time", label: "時刻", timePrecision: precision }];
    const out = collectResponses(schema, { q_t: "12:34:56.789" });
    return out["時刻"];
  };
  assert.equal(run("minute"), "12:34");
  assert.equal(run("second"), "12:34:56");
  assert.equal(run("millisecond"), "12:34:56.789");
  // precision 未指定は既定（秒）
  const out = collectResponses([{ id: "q_t", type: "time", label: "時刻" }], { q_t: "12:34:56.789" });
  assert.equal(out["時刻"], "12:34:56");
});

test("collectResponses: チェックボックスは選択肢ごとのマーカー列（設定順）で保存する", () => {
  const schema = [
    {
      id: "q_parent",
      type: "checkboxes",
      label: "親",
      options: [
        { id: "opt_b", label: "B" },
        { id: "opt_a", label: "A" },
      ],
      childrenByValue: {
        A: [{ id: "q_a", type: "text", label: "A子" }],
        B: [{ id: "q_b", type: "text", label: "B子" }],
      },
    },
  ];
  const responses = {
    q_parent: ["A", "B"],
    q_a: "a-value",
    q_b: "b-value",
  };

  const raw = collectResponses(schema, responses);
  const sorted = sortResponses(raw, schema);

  // 元データ方式: 選択肢はオプション単位列 `親/選択肢`=●。並びはフォーム設定順（B,A）。
  assert.deepEqual(sorted.keys, ["親/B", "親/A", "親/B/B子", "親/A/A子"]);
  assert.deepEqual(Object.keys(sorted.map), ["親/B", "親/A", "親/B/B子", "親/A/A子"]);
  assert.equal(sorted.map["親/B"], "●");
  assert.equal(sorted.map["親/A"], "●");
  assert.equal(sorted.map["親/B/B子"], "b-value");
  assert.equal(sorted.map["親/A/A子"], "a-value");
});

test("collectResponses: 選択肢はラベルをそのままオプション列キーに使う（マーカー ●）", () => {
  const schema = [
    {
      id: "q_c",
      type: "checkboxes",
      label: "色",
      options: [{ id: "o1", label: "赤, 青" }, { id: "o2", label: "カラス" }],
    },
    {
      id: "q_r",
      type: "radio",
      label: "性別",
      options: [{ id: "m", label: "男" }, { id: "f", label: "女" }],
    },
  ];
  const raw = collectResponses(schema, { q_c: ["赤, 青", "カラス"], q_r: "男" });
  assert.equal(raw["色/赤, 青"], "●");
  assert.equal(raw["色/カラス"], "●");
  assert.equal(raw["性別/男"], "●");
});

test("collectResponsesは電話番号を単一値として出力する", () => {
  const schema = [
    { id: "q_phone", type: "phone", label: "電話番号" },
  ];
  const responses = {
    q_phone: "090-1234-5678",
  };

  const raw = collectResponses(schema, responses);
  assert.equal(raw["電話番号"], "090-1234-5678");
});

test("buildFileUploadEntry は GAS 応答をファイルエントリ形式に整形する", () => {
  assert.deepEqual(
    buildFileUploadEntry({ fileName: "a.pdf", fileId: "id_1", fileUrl: "https://drive/1" }),
    { name: "a.pdf", driveFileId: "id_1", driveFileUrl: "https://drive/1" },
  );
});

test("buildFileUploadEntry は欠損フィールドを空文字で埋める", () => {
  assert.deepEqual(
    buildFileUploadEntry({ fileName: "b.png" }),
    { name: "b.png", driveFileId: "", driveFileUrl: "" },
  );
  assert.deepEqual(
    buildFileUploadEntry({}),
    { name: "", driveFileId: "", driveFileUrl: "" },
  );
  assert.deepEqual(
    buildFileUploadEntry(null),
    { name: "", driveFileId: "", driveFileUrl: "" },
  );
});

test("collectResponses は date 型値を YYYY-MM-DD に正規化する（時刻成分を削ぎ落とす）", () => {
  const schema = [
    { id: "q_date", type: "date", label: "受付日" },
  ];
  // ISO 形式に時刻が混じったケース：時刻成分は削ぎ落とされる
  const raw = collectResponses(schema, { q_date: "2026-03-14T15:30:45" });
  assert.equal(raw["受付日"], "2026-03-14");
});

test("collectResponses は time 型値を HH:mm:ss に正規化する（日付成分を削ぎ落とす）", () => {
  const schema = [
    { id: "q_time", type: "time", label: "受付時刻" },
  ];
  // 日付付きの time 値が入ってきたら時刻のみ残す（基準日 1899-12-30 は GAS 側で付与）
  const raw = collectResponses(schema, { q_time: "2026-03-14 09:30:00" });
  assert.equal(raw["受付時刻"], "09:30:00");
});

test("collectResponses は date / time の canonical 入力をそのままの意味で出力する", () => {
  const schema = [
    { id: "q_date", type: "date", label: "受付日" },
    { id: "q_time", type: "time", label: "受付時刻" },
  ];
  const raw = collectResponses(schema, { q_date: "2026-03-14", q_time: "09:30" });
  assert.equal(raw["受付日"], "2026-03-14");
  assert.equal(raw["受付時刻"], "09:30:00");
});

test("collectResponses は不正な date / time 値をエントリから除外する", () => {
  const schema = [
    { id: "q_date", type: "date", label: "受付日" },
    { id: "q_time", type: "time", label: "受付時刻" },
  ];
  const raw = collectResponses(schema, { q_date: "invalid", q_time: "not-a-time" });
  assert.equal(Object.prototype.hasOwnProperty.call(raw, "受付日"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(raw, "受付時刻"), false);
});

test("collectResponses は number 型の文字列入力を Number に変換して出力する", () => {
  const schema = [
    { id: "q_qty", type: "number", label: "数量" },
  ];
  const raw = collectResponses(schema, { q_qty: "3" });
  assert.equal(raw["数量"], 3);
  assert.equal(typeof raw["数量"], "number");
});

test("collectResponses は number 型の小数・負数を Number に変換する", () => {
  const schema = [
    { id: "q_a", type: "number", label: "値A" },
    { id: "q_b", type: "number", label: "値B" },
  ];
  const raw = collectResponses(schema, { q_a: "-3.14", q_b: "1e3" });
  assert.equal(raw["値A"], -3.14);
  assert.equal(raw["値B"], 1000);
});

test("collectResponses は既に number で来た値もそのまま number で出す", () => {
  const schema = [
    { id: "q_qty", type: "number", label: "数量" },
  ];
  const raw = collectResponses(schema, { q_qty: 42 });
  assert.equal(raw["数量"], 42);
  assert.equal(typeof raw["数量"], "number");
});

test("collectResponses は number 型の不正値（数値でない文字列）をエントリから除外する", () => {
  const schema = [
    { id: "q_qty", type: "number", label: "数量" },
  ];
  const raw = collectResponses(schema, { q_qty: "abc" });
  assert.equal(Object.prototype.hasOwnProperty.call(raw, "数量"), false);
});

test("collectResponses と sortResponses は printTemplate を回答データに含めない", () => {
  const schema = [
    { id: "q_name", type: "text", label: "氏名" },
    {
      id: "q_print",
      type: "printTemplate",
      label: "様式出力",
      printTemplateAction: { enabled: true, fileNameTemplate: "print_${recordId}" },
    },
  ];
  const responses = {
    q_name: "山田太郎",
    q_print: "ignored",
  };

  const raw = collectResponses(schema, responses);
  const sorted = sortResponses(raw, schema);

  assert.deepEqual(raw, { 氏名: "山田太郎" });
  assert.deepEqual(sorted.keys, ["氏名"]);
  assert.deepEqual(sorted.map, { 氏名: "山田太郎" });
});
