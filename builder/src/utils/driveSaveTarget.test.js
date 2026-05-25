import test from "node:test";
import assert from "node:assert/strict";
import { validateDriveSaveTarget } from "./driveSaveTarget.js";

const FILE_URL = "https://drive.google.com/file/d/abc123_-/view";
const FOLDER_URL = "https://drive.google.com/drive/folders/xyz789_-";

test("空 → ok / targetUrl=null", () => {
  assert.deepEqual(validateDriveSaveTarget("", { isEdit: false, itemLabel: "Question" }), { ok: true, targetUrl: null });
  assert.deepEqual(validateDriveSaveTarget("   ", { isEdit: true, itemLabel: "Question" }), { ok: true, targetUrl: null });
  assert.deepEqual(validateDriveSaveTarget(null, { isEdit: false, itemLabel: "Question" }), { ok: true, targetUrl: null });
});

test("フォルダ URL → ok", () => {
  assert.deepEqual(
    validateDriveSaveTarget(FOLDER_URL, { isEdit: false, itemLabel: "Question" }),
    { ok: true, targetUrl: FOLDER_URL }
  );
  assert.deepEqual(
    validateDriveSaveTarget(`  ${FOLDER_URL}  `, { isEdit: true, itemLabel: "Dashboard" }),
    { ok: true, targetUrl: FOLDER_URL }
  );
});

test("新規作成 + ファイル URL → エラー", () => {
  const r = validateDriveSaveTarget(FILE_URL, { isEdit: false, itemLabel: "Question" });
  assert.equal(r.ok, false);
  assert.match(r.error, /新規作成時はファイルURLは指定できません/);
});

test("編集 + 元と異なるファイル URL → エラー（itemLabel 反映）", () => {
  const r = validateDriveSaveTarget(FILE_URL, { isEdit: true, originalFileUrl: "https://drive.google.com/file/d/other/view", itemLabel: "Dashboard" });
  assert.equal(r.ok, false);
  assert.match(r.error, /既存 Dashboard の保存先/);
});

test("編集 + 元と同じファイル URL → ok", () => {
  assert.deepEqual(
    validateDriveSaveTarget(FILE_URL, { isEdit: true, originalFileUrl: FILE_URL, itemLabel: "Question" }),
    { ok: true, targetUrl: FILE_URL }
  );
});

test("ファイルでもフォルダでもない URL → エラー", () => {
  const r = validateDriveSaveTarget("https://example.com/whatever", { isEdit: false, itemLabel: "Question" });
  assert.equal(r.ok, false);
  assert.match(r.error, /形式が不正/);
});
