import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isLocalId } from "../../core/ids.js";
import { subscribeTempIdResolved, getResolvedRealId } from "../state/uploadWorker.js";

/**
 * URL に一時 ID(local_…) のフォーム/クエスチョン/ダッシュボードが乗っている場合に、
 * バックグラウンドアップロード完了で実 fileId が確定したら自動で実 ID の URL へ置き換える。
 *
 * 通常の「作成→保存→一覧へ戻る」導線では一時 ID が URL に乗らないため防御的な保険だが、
 * 一時 ID をディープリンクで直接開いたケース（ダッシュボード閲覧など）を救済する。
 *
 * @param {string} currentId 現在の URL パラメータ（エンティティ ID）
 * @param {(realId: string) => string} buildPath 実 ID から遷移先パスを作る（useCallback で安定化推奨）
 */
export function useTempIdRedirect(currentId, buildPath) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!currentId || !isLocalId(currentId) || typeof buildPath !== "function") return undefined;
    const already = getResolvedRealId(currentId);
    if (already) {
      navigate(buildPath(already), { replace: true });
      return undefined;
    }
    return subscribeTempIdResolved((tempId, realId) => {
      if (tempId === currentId) navigate(buildPath(realId), { replace: true });
    });
  }, [currentId, navigate, buildPath]);
}
