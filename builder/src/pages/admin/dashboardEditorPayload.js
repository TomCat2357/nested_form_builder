// DashboardEditorPage の保存ペイロード構築（純関数）。
// React state（dashboard）から保存用ペイロードを組み立てる変換をコンポーネントから切り出す。
// 副作用なし。modifiedAt はテスト容易性のため now を注入可能にする。

import { normalizeFolderPath, joinFolderPath } from "../../utils/folderTree.js";

// question の論理パス（"フォルダ/名前"）を questions 一覧から導出する。未解決は "" を返す。
function questionPathForId(questionId, questions) {
  if (!questionId || !Array.isArray(questions)) return "";
  const q = questions.find((x) => x && x.id === questionId);
  if (!q) return "";
  return joinFolderPath(q.folder, q.name || "") || "";
}

// 保存ペイロードを組み立てる。
//  - 名前が空 → { error }
//  - 成功     → { payload }
// 参照は fileId（questionId）を正本に持ち、復旧アンカーとして論理パス questionPath を冗長保存する
// （読み込んだ旧 questionName は剥がす）。questions が渡されない場合は path 空（GAS 側 stamp が補完）。
export function buildDashboardPayload({ dashboard, dashboardId, questions, now = Date.now() }) {
  if (!dashboard || !dashboard.name || !dashboard.name.trim()) {
    return { error: "ダッシュボード名を入力してください。" };
  }
  return {
    payload: {
      ...dashboard,
      // id ＝ Drive fileId。新規はクライアントで採番せず、保存後に GAS が返す fileId を採用する。
      id: dashboard.id || dashboardId || undefined,
      schemaVersion: 2,
      name: dashboard.name.trim(),
      description: (dashboard.description || "").trim(),
      folder: normalizeFolderPath(dashboard.folder),
      cards: (dashboard.cards || []).map((c) => {
        if (c.type === "message" || !c.questionId) return c;
        const { questionName: _staleQuestionName, questionPath: prevPath, ...rest } = c;
        const computed = questionPathForId(c.questionId, questions);
        // 質問が現在の一覧に無い（アーカイブ/未ロード/削除）ときは既存の論理パスを温存し、空で上書きしない。
        return { ...rest, questionPath: computed || (typeof prevPath === "string" ? prevPath : "") };
      }),
      modifiedAt: now,
    },
  };
}
