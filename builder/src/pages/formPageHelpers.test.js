import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregatePrimaryUploadFolder,
  broadcastPrimaryUploadFolder,
} from "./formPageHelpers.js";

const FIELDS = [{ id: "f_primary" }, { id: "f_second" }, { id: "f_third" }];

test("aggregatePrimaryUploadFolder: primary カラムのフォルダ情報をそのまま拾う", () => {
  const result = aggregatePrimaryUploadFolder(
    FIELDS,
    { f_primary: "https://drive.google.com/drive/folders/P" },
    { f_primary: "record_p" },
  );
  assert.deepEqual(result, { url: "https://drive.google.com/drive/folders/P", folderName: "record_p" });
});

test("aggregatePrimaryUploadFolder: primary が空でも後続カラムから最初の非空を集約する（旧データ互換）", () => {
  const result = aggregatePrimaryUploadFolder(
    FIELDS,
    { f_second: "https://drive.google.com/drive/folders/S" },
    { f_second: "record_s" },
  );
  assert.deepEqual(result, { url: "https://drive.google.com/drive/folders/S", folderName: "record_s" });
});

test("aggregatePrimaryUploadFolder: url と folderName を別カラムから独立に拾う", () => {
  const result = aggregatePrimaryUploadFolder(
    FIELDS,
    { f_third: "https://drive.google.com/drive/folders/T" },
    { f_second: "record_s" },
  );
  assert.deepEqual(result, { url: "https://drive.google.com/drive/folders/T", folderName: "record_s" });
});

test("aggregatePrimaryUploadFolder: どのカラムにも無ければ空を返す", () => {
  assert.deepEqual(aggregatePrimaryUploadFolder(FIELDS, {}, {}), { url: "", folderName: "" });
  assert.deepEqual(aggregatePrimaryUploadFolder([], {}, {}), { url: "", folderName: "" });
});

test("broadcastPrimaryUploadFolder: primary の確定フォルダを実ファイルを持つ各セルへ配る", () => {
  const { folderUrls, folderNames } = broadcastPrimaryUploadFolder(
    FIELDS,
    {
      // primary カードにはファイルが無く、2 枚目のカードにファイルがある（state は primary に集約済み）
      f_second: [{ name: "a.pdf", driveFileId: "id_a" }],
      f_third: [{ name: "b.pdf", driveFileId: "id_b" }],
    },
    { f_primary: "https://drive.google.com/drive/folders/P" },
    { f_primary: "record_p" },
  );
  // 実ファイルを持つカードには primary の参照が載る
  assert.equal(folderUrls.f_second, "https://drive.google.com/drive/folders/P");
  assert.equal(folderNames.f_second, "record_p");
  assert.equal(folderUrls.f_third, "https://drive.google.com/drive/folders/P");
  assert.equal(folderNames.f_third, "record_p");
  // primary 自身は（ファイルが無くても）所有フォルダ参照を保持する＝レコードフォルダの正本セル
  // （フォルダ作成ボタンのみ実行→未アップロード保存の従来挙動を退行させない）。
  assert.equal(folderUrls.f_primary, "https://drive.google.com/drive/folders/P");
  assert.equal(folderNames.f_primary, "record_p");
});

test("broadcastPrimaryUploadFolder: primary 自身がファイルを持つ場合も同一フォルダを載せる", () => {
  const { folderUrls, folderNames } = broadcastPrimaryUploadFolder(
    FIELDS,
    { f_primary: [{ name: "a.pdf", driveFileId: "id_a" }] },
    { f_primary: "https://drive.google.com/drive/folders/P" },
    { f_primary: "record_p" },
  );
  assert.equal(folderUrls.f_primary, "https://drive.google.com/drive/folders/P");
  assert.equal(folderNames.f_primary, "record_p");
  // ファイル無しカードは空
  assert.equal(folderUrls.f_second, "");
  assert.equal(folderNames.f_second, "");
});

test("broadcastPrimaryUploadFolder: primary に確定 URL が無ければ per-field 確定値を尊重する", () => {
  const { folderUrls, folderNames } = broadcastPrimaryUploadFolder(
    FIELDS,
    { f_second: [{ name: "a.pdf", driveFileId: "id_a" }] },
    { f_second: "https://drive.google.com/drive/folders/S" },
    { f_second: "record_s" },
  );
  // primary URL が空なのでブロードキャストは発生せず、各 field の確定値がそのまま使われる
  assert.equal(folderUrls.f_second, "https://drive.google.com/drive/folders/S");
  assert.equal(folderNames.f_second, "record_s");
  assert.equal(folderUrls.f_primary, "");
});

test("broadcastPrimaryUploadFolder: 単一カードは従来どおり自分の確定値を持つ（挙動不変）", () => {
  const { folderUrls, folderNames } = broadcastPrimaryUploadFolder(
    [{ id: "f_only" }],
    { f_only: [{ name: "a.pdf", driveFileId: "id_a" }] },
    { f_only: "https://drive.google.com/drive/folders/O" },
    { f_only: "record_o" },
  );
  assert.equal(folderUrls.f_only, "https://drive.google.com/drive/folders/O");
  assert.equal(folderNames.f_only, "record_o");
});
