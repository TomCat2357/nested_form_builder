/**
 * adminListConfirmTexts のスナップショットテスト。
 *
 * AdminFormListPage / AdminAnalyticsListPage にインラインで書かれていた確認ダイアログ
 * 文言を共通化した際の「バイト一致」を固定する。文言を意図的に変えるときはここも更新する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formConfirmTexts, buildAnalyticsConfirmTexts } from "./adminListConfirmTexts.js";

test("formConfirmTexts: アーカイブ", () => {
  assert.equal(formConfirmTexts.archive.title({ allArchived: false }), "フォームをアーカイブ");
  assert.equal(formConfirmTexts.archive.title({ allArchived: true }), "アーカイブを解除");
  assert.equal(
    formConfirmTexts.archive.message({ allArchived: false }),
    "このフォームをアーカイブします。検索画面には表示されなくなります。よろしいですか？"
  );
  assert.equal(
    formConfirmTexts.archive.message({ allArchived: true }),
    "このフォームのアーカイブを解除して公開中に戻します。よろしいですか？"
  );
});

test("formConfirmTexts: リンク解除（単体 / 複数 / フォルダ）", () => {
  assert.equal(formConfirmTexts.remove.title({ folderPaths: [] }), "フォームをリンク解除");
  assert.equal(formConfirmTexts.remove.title({ folderPaths: ["a"] }), "フォルダをリンク解除");
  assert.equal(
    formConfirmTexts.remove.message({ folderPaths: [], multiple: false }),
    "このフォームのリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
  );
  assert.equal(
    formConfirmTexts.remove.message({ folderPaths: [], multiple: true }),
    "選択したフォームのリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
  );
  assert.equal(
    formConfirmTexts.remove.message({ folderPaths: ["a"], folderFormCount: 3 }),
    "選択したフォルダのリンクを解除します。中の 3 個のフォームのリンクも併せて解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
  );
});

test("formConfirmTexts: 削除 / コピー", () => {
  assert.equal(formConfirmTexts.hardRemove.title({}), "フォームを削除");
  assert.equal(
    formConfirmTexts.hardRemove.message({ multiple: false }),
    "このフォームを削除します。プロジェクト内（標準フォルダ配下）のファイルは Drive のゴミ箱へ移動します。プロジェクト外のファイルはリンク（登録）解除のみで実体は残します。よろしいですか？"
  );
  assert.equal(
    formConfirmTexts.hardRemove.message({ multiple: true }),
    "選択したフォームを削除します。プロジェクト内（標準フォルダ配下）のファイルは Drive のゴミ箱へ移動します。プロジェクト外のファイルはリンク（登録）解除のみで実体は残します。よろしいですか？"
  );
  assert.equal(formConfirmTexts.copy.title({}), "フォームをコピー");
  assert.equal(
    formConfirmTexts.copy.message({}),
    "コピーしたフォームは、コピー元と同じスプレッドシートにデータが保存されます。そのままではデータが混在するため、コピー後にフォーム設定画面から新しいスプレッドシートのURLに変更してください。"
  );
});

test("buildAnalyticsConfirmTexts: アーカイブ", () => {
  const t = buildAnalyticsConfirmTexts("Question");
  assert.equal(t.archive.title({ allArchived: false }), "Question をアーカイブ");
  assert.equal(t.archive.title({ allArchived: true }), "アーカイブを解除");
  assert.equal(
    t.archive.message({ allArchived: false }),
    "選択した Question をアーカイブします。一覧に表示されなくなります。よろしいですか？"
  );
  assert.equal(
    t.archive.message({ allArchived: true }),
    "選択した Question のアーカイブを解除して公開中に戻します。よろしいですか？"
  );
});

test("buildAnalyticsConfirmTexts: リンク解除（単体 / 複数 / フォルダ）", () => {
  const t = buildAnalyticsConfirmTexts("Dashboard");
  assert.equal(t.remove.title({ folderPaths: [] }), "Dashboard をリンク解除");
  assert.equal(t.remove.title({ folderPaths: ["a"] }), "フォルダをリンク解除");
  assert.equal(
    t.remove.message({ folderPaths: [], multiple: false }),
    "この Dashboard のリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
  );
  assert.equal(
    t.remove.message({ folderPaths: [], multiple: true }),
    "選択した Dashboard のリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
  );
  assert.equal(
    t.remove.message({ folderPaths: ["a"], folderItemCount: 2 }),
    "選択したフォルダのリンクを解除します。中の 2 個の Dashboard のリンクも併せて解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
  );
});

test("buildAnalyticsConfirmTexts: 削除 / コピー", () => {
  const t = buildAnalyticsConfirmTexts("Question");
  assert.equal(t.hardRemove.title({}), "Question を削除");
  assert.equal(
    t.hardRemove.message({ multiple: false }),
    "この Question を削除します。プロジェクト内（標準フォルダ配下）のファイルは Drive のゴミ箱へ移動します。プロジェクト外のファイルはリンク（登録）解除のみで実体は残します。よろしいですか？"
  );
  assert.equal(
    t.hardRemove.message({ multiple: true }),
    "選択した Question を削除します。プロジェクト内（標準フォルダ配下）のファイルは Drive のゴミ箱へ移動します。プロジェクト外のファイルはリンク（登録）解除のみで実体は残します。よろしいですか？"
  );
  assert.equal(t.copy.title({}), "Question をコピー");
  assert.equal(
    t.copy.message({}),
    "同じフォルダに「（コピー）」を付けて新しい Question を作成します。コピー後に名前を変更してください。"
  );
});
