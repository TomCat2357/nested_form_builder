/**
 * 管理一覧ページ共通の確認ダイアログ（アーカイブ / リンク解除 / 削除 / コピー）の文言定義。
 *
 * AdminListConfirmDialogs.jsx が消費する。フォーム一覧と Analytics（Question / Dashboard /
 * CrossSearch）一覧で文言だけが異なるため、state を受け取る純関数の束として切り出し、
 * adminListConfirmTexts.test.js で両構成の全メッセージをスナップショット固定する。
 *
 * 契約: 各ダイアログは { title(state), message(state) }。アーカイブのみ確定ボタンの
 * ラベルが state.allArchived で変わる（"解除" / "アーカイブ"）が、それはコンポーネント側の共通処理。
 */

const HARD_DELETE_SUFFIX =
  "プロジェクト内（標準フォルダ配下）のファイルは Drive のゴミ箱へ移動します。" +
  "プロジェクト外のファイルはリンク（登録）解除のみで実体は残します。よろしいですか？";

/** フォーム一覧（AdminFormListPage）の文言。単票口調（「このフォーム」）を維持する。 */
export const formConfirmTexts = {
  archive: {
    title: (s) => (s.allArchived ? "アーカイブを解除" : "フォームをアーカイブ"),
    message: (s) => (
      s.allArchived
        ? "このフォームのアーカイブを解除して公開中に戻します。よろしいですか？"
        : "このフォームをアーカイブします。検索画面には表示されなくなります。よろしいですか？"
    ),
  },
  remove: {
    title: (s) => (s.folderPaths?.length ? "フォルダをリンク解除" : "フォームをリンク解除"),
    message: (s) => (
      s.folderPaths?.length
        ? `選択したフォルダのリンクを解除します。中の ${s.folderFormCount} 個のフォームのリンクも併せて解除します。Drive 上のファイル本体は削除されません。よろしいですか？`
        : s.multiple
          ? "選択したフォームのリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
          : "このフォームのリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
    ),
  },
  hardRemove: {
    title: () => "フォームを削除",
    message: (s) => (
      (s.multiple ? "選択したフォームを削除します。" : "このフォームを削除します。") + HARD_DELETE_SUFFIX
    ),
  },
  copy: {
    title: () => "フォームをコピー",
    message: () => (
      "コピーしたフォームは、コピー元と同じスプレッドシートにデータが保存されます。" +
      "そのままではデータが混在するため、コピー後にフォーム設定画面から新しいスプレッドシートのURLに変更してください。"
    ),
  },
};

/** Analytics 一覧（AdminAnalyticsListPage）の文言。itemLabel（"Question" 等）を差し込む。 */
export const buildAnalyticsConfirmTexts = (itemLabel) => ({
  archive: {
    title: (s) => (s.allArchived ? "アーカイブを解除" : `${itemLabel} をアーカイブ`),
    message: (s) => (
      s.allArchived
        ? `選択した ${itemLabel} のアーカイブを解除して公開中に戻します。よろしいですか？`
        : `選択した ${itemLabel} をアーカイブします。一覧に表示されなくなります。よろしいですか？`
    ),
  },
  remove: {
    title: (s) => (s.folderPaths?.length ? "フォルダをリンク解除" : `${itemLabel} をリンク解除`),
    message: (s) => (
      s.folderPaths?.length
        ? `選択したフォルダのリンクを解除します。中の ${s.folderItemCount} 個の ${itemLabel} のリンクも併せて解除します。Drive 上のファイル本体は削除されません。よろしいですか？`
        : s.multiple
          ? `選択した ${itemLabel} のリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？`
          : `この ${itemLabel} のリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？`
    ),
  },
  hardRemove: {
    title: () => `${itemLabel} を削除`,
    message: (s) => (
      (s.multiple ? `選択した ${itemLabel} を削除します。` : `この ${itemLabel} を削除します。`) + HARD_DELETE_SUFFIX
    ),
  },
  copy: {
    title: () => `${itemLabel} をコピー`,
    message: () => `同じフォルダに「（コピー）」を付けて新しい ${itemLabel} を作成します。コピー後に名前を変更してください。`,
  },
});
