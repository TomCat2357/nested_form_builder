// DashboardEditorPage の保存ペイロード構築（純関数）。
// React state（dashboard）から保存用ペイロードを組み立てる変換をコンポーネントから切り出す。
// 副作用なし。modifiedAt はテスト容易性のため now を注入可能にする。

import { normalizeFolderPath } from "../../utils/folderTree.js";

// 保存ペイロードを組み立てる。
//  - 名前が空 → { error }
//  - 成功     → { payload }
// 参照は fileId（questionId）のみで保持し、読み込んだ旧 questionName は剥がす。
export function buildDashboardPayload({ dashboard, dashboardId, now = Date.now() }) {
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
        const { questionName: _staleQuestionName, ...rest } = c;
        return rest;
      }),
      modifiedAt: now,
    },
  };
}
