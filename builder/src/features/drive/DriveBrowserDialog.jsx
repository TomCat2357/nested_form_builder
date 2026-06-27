import React, { useCallback, useEffect, useRef, useState } from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";
import { buildDriveFileViewUrl } from "../../utils/externalActionUrl.js";
import {
  driveBrowserList,
  driveBrowserSearch,
  driveBrowserListSharedDrives,
  driveBrowserListStarred,
} from "../../services/gasClient.js";

// 既定クライアント。テスト時は client prop で差し替え可能。
const DEFAULT_CLIENT = {
  list: driveBrowserList,
  search: driveBrowserSearch,
  listSharedDrives: driveBrowserListSharedDrives,
  listStarred: driveBrowserListStarred,
};

// パンくずはサーバではなくクライアントで保持する（フォルダを開くたびのサーバ祖先探索を避けて高速化）。
const ROOT_CRUMB = { id: "", name: "マイドライブ" };
const SHARED_LIST_CRUMB = { id: "__shared_list__", name: "共有ドライブ", virtual: true };

// 選択アイテムから、下流の既存解析（Forms_parseGoogleDriveUrl_）に合う URL を生成する。
function buildDriveUrl(item) {
  if (!item || !item.id) return "";
  if (item.type === "folder") return `https://drive.google.com/drive/folders/${item.id}`;
  return buildDriveFileViewUrl(item.id);
}

function formatUpdated(ms) {
  if (typeof ms !== "number" || !ms) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch (e) {
    return "";
  }
}

function isSameItem(a, b) {
  return Boolean(a && b && a.id === b.id && a.type === b.type);
}

// Drive をブラウズして file / folder を 1 件選ぶ再利用ピッカー。
// onSelect は { id, url, name, type } を返す。select は "file" | "folder" | "both"。
// mode はファイル絞り込み（"all" | "json" | "css" | "folders"）でサーバへ渡す。
export default function DriveBrowserDialog({
  open,
  mode = "all",
  select = "file",
  title = "Google Drive から選択",
  onSelect,
  onCancel,
  client = DEFAULT_CLIENT,
}) {
  const [view, setView] = useState("browse"); // browse | search | starred | shared
  const [pathStack, setPathStack] = useState([ROOT_CRUMB]);
  const [driveId, setDriveId] = useState(""); // 共有ドライブ内なら driveId、My ドライブなら ""
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sharedAvailable, setSharedAvailable] = useState(false);

  const reqRef = useRef(0); // 競合する非同期応答を破棄するための世代カウンタ

  const canSelectItem = useCallback((item) => {
    if (!item) return false;
    if (item.type === "folder") return select === "folder" || select === "both";
    return select === "file" || select === "both";
  }, [select]);

  // ローディング・エラー・世代管理を共通化したフェッチ。古い応答は破棄する。
  const runLoad = useCallback(async (fn) => {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError("");
    setSelected(null);
    try {
      const result = await fn();
      if (reqRef.current !== reqId) return null;
      return result;
    } catch (err) {
      if (reqRef.current === reqId) setError(err?.message || "読み込みに失敗しました");
      return null;
    } finally {
      if (reqRef.current === reqId) setLoading(false);
    }
  }, []);

  // フォルダの中身だけを取得（パンくずは呼び出し側が pathStack で管理）。
  const fetchItems = useCallback(async (folderId, driveIdArg) => {
    const result = await runLoad(() => client.list({ folderId: folderId || "", mode, driveId: driveIdArg || "" }));
    if (!result) return;
    setItems(Array.isArray(result.items) ? result.items : []);
    setTruncated(Boolean(result.truncated));
  }, [client, mode, runLoad]);

  const openMyDrive = useCallback(() => {
    setView("browse");
    setDriveId("");
    setPathStack([ROOT_CRUMB]);
    fetchItems("", "");
  }, [fetchItems]);

  const loadStarred = useCallback(async () => {
    setView("starred");
    const result = await runLoad(() => client.listStarred({ mode }));
    if (!result) return;
    setItems(Array.isArray(result.items) ? result.items : []);
    setTruncated(Boolean(result.truncated));
  }, [client, mode, runLoad]);

  const loadSharedList = useCallback(async () => {
    setView("shared");
    const result = await runLoad(() => client.listSharedDrives());
    if (!result) return;
    const drives = Array.isArray(result.drives) ? result.drives : [];
    setItems(drives.map((d) => ({ id: d.id, name: d.name, type: "folder", mimeType: "", isShortcut: false })));
    setTruncated(false);
  }, [client, runLoad]);

  const runSearch = useCallback(async () => {
    const query = searchText.trim();
    if (!query) return;
    setView("search");
    const result = await runLoad(() => client.search({ query, mode }));
    if (!result) return;
    setItems(Array.isArray(result.items) ? result.items : []);
    setTruncated(Boolean(result.truncated));
  }, [client, mode, runLoad, searchText]);

  // open 時の初期化（マイドライブのルート読込 + 共有ドライブタブの可否判定）
  useEffect(() => {
    if (!open) return;
    setSearchText("");
    setError("");
    setView("browse");
    setDriveId("");
    setPathStack([ROOT_CRUMB]);
    fetchItems("", "");
    client.listSharedDrives()
      .then((result) => setSharedAvailable(Boolean(result && result.available)))
      .catch(() => setSharedAvailable(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // フォルダに入る（browse 中は pathStack に積む / 検索・スター結果からは起点リセット）。
  const descend = (item) => {
    if (view === "browse") {
      setPathStack((prev) => [...prev, { id: item.id, name: item.name }]);
      setView("browse");
      fetchItems(item.id, driveId);
    } else {
      setDriveId("");
      setPathStack([{ id: item.id, name: item.name }]);
      setView("browse");
      fetchItems(item.id, "");
    }
  };

  const enterSharedDrive = (drive) => {
    setView("browse");
    setDriveId(drive.id);
    setPathStack([SHARED_LIST_CRUMB, { id: drive.id, name: drive.name }]);
    fetchItems(drive.id, drive.id);
  };

  const goToCrumb = (index) => {
    const crumb = pathStack[index];
    if (!crumb) return;
    if (crumb.virtual) { loadSharedList(); return; }
    setPathStack(pathStack.slice(0, index + 1));
    fetchItems(crumb.id, driveId);
  };

  const goBack = () => {
    if (pathStack.length <= 1) return;
    goToCrumb(pathStack.length - 2);
  };

  const handleRowClick = (item) => {
    if (view === "shared") { enterSharedDrive(item); return; }
    if (item.type === "folder") {
      if (canSelectItem(item)) setSelected(item);
      else descend(item);
    } else if (canSelectItem(item)) {
      setSelected(item);
    }
  };

  const handleRowDoubleClick = (item) => {
    if (view === "shared") return;
    if (item.type === "folder") descend(item);
  };

  const confirmSelection = (item) => {
    if (!item || !item.id) return;
    if (typeof onSelect === "function") {
      onSelect({ id: item.id, url: buildDriveUrl(item), name: item.name, type: item.type });
    }
  };

  const currentCrumb = pathStack[pathStack.length - 1];
  const canConfirmSelected = selected && canSelectItem(selected);
  const canConfirmCurrentFolder = (select === "folder" || select === "both")
    && view === "browse" && currentCrumb && currentCrumb.id && !currentCrumb.virtual;

  const activeTab = view === "starred" ? "starred" : (view === "shared" ? "shared" : "mydrive");

  const tabButtonStyle = (key) => ({
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: activeTab === key ? "var(--primary-soft)" : "var(--surface-subtle)",
    color: activeTab === key ? "var(--primary)" : "var(--text, inherit)",
    fontWeight: activeTab === key ? 600 : 400,
    cursor: "pointer",
    fontSize: 12,
  });

  return (
    <BaseDialog
      open={open}
      title={title}
      footer={
        <>
          <button type="button" className="dialog-btn" onClick={onCancel}>
            キャンセル
          </button>
          {canConfirmCurrentFolder && (
            <button
              type="button"
              className="dialog-btn"
              onClick={() => confirmSelection({ id: currentCrumb.id, name: currentCrumb.name, type: "folder" })}
            >
              このフォルダを選択
            </button>
          )}
          <button
            type="button"
            className="dialog-btn primary"
            onClick={() => confirmSelection(selected)}
            disabled={!canConfirmSelected}
          >
            選択
          </button>
        </>
      }
    >
      {/* タブ */}
      <div className="nf-row nf-gap-8">
        <button type="button" style={tabButtonStyle("mydrive")} onClick={openMyDrive}>
          マイドライブ
        </button>
        <button type="button" style={tabButtonStyle("starred")} onClick={loadStarred}>
          スター付き
        </button>
        {sharedAvailable && (
          <button type="button" style={tabButtonStyle("shared")} onClick={loadSharedList}>
            共有ドライブ
          </button>
        )}
      </div>

      {/* 検索 */}
      <div className="nf-row nf-gap-8">
        <input
          type="text"
          className="nf-input nf-flex-1"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") runSearch(); }}
          placeholder="ファイル名・フォルダ名で検索"
        />
        <button type="button" className="nf-btn" onClick={runSearch} disabled={!searchText.trim()}>
          検索
        </button>
      </div>

      {/* パンくず / 戻る（browse のみ） */}
      {view === "browse" && (
        <div className="nf-row nf-gap-8 nf-items-center" style={{ flexWrap: "wrap" }}>
          {pathStack.length > 1 && (
            <button type="button" className="nf-btn nf-text-11" style={{ padding: "2px 8px" }} onClick={goBack}>
              ← 戻る
            </button>
          )}
          <div className="nf-text-12 nf-text-muted" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {pathStack.map((crumb, index) => (
              <span key={`${crumb.id}-${index}`}>
                <button
                  type="button"
                  onClick={() => goToCrumb(index)}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", cursor: "pointer", fontSize: 12 }}
                >
                  {crumb.name}
                </button>
                {index < pathStack.length - 1 && <span style={{ margin: "0 2px" }}>/</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {(view === "search" || view === "starred" || view === "shared") && (
        <div className="nf-text-12 nf-text-muted">
          {view === "search" && `検索結果: ${searchText.trim()}`}
          {view === "starred" && "スター付き"}
          {view === "shared" && "共有ドライブを選択してください"}
        </div>
      )}

      {/* 一覧 */}
      <div
        style={{
          border: "1px solid var(--border-strong)",
          borderRadius: 6,
          maxHeight: 320,
          overflowY: "auto",
          minHeight: 120,
        }}
      >
        {loading && <div className="nf-text-12 nf-text-muted" style={{ padding: 12 }}>読み込み中...</div>}
        {!loading && error && <div className="nf-text-danger-ink nf-text-12" style={{ padding: 12 }}>{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="nf-text-12 nf-text-muted" style={{ padding: 12 }}>項目がありません</div>
        )}
        {!loading && !error && items.map((item) => {
          const selectable = view === "shared" ? true : canSelectItem(item);
          const isSelected = isSameItem(selected, item);
          return (
            <div
              key={`${item.type}-${item.id}`}
              onClick={() => handleRowClick(item)}
              onDoubleClick={() => handleRowDoubleClick(item)}
              className="nf-row nf-gap-8 nf-items-center"
              style={{
                padding: "6px 10px",
                cursor: selectable || item.type === "folder" ? "pointer" : "default",
                background: isSelected ? "var(--primary-soft)" : "transparent",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span aria-hidden="true">{item.type === "folder" ? "📁" : "📄"}</span>
              <span className="nf-flex-1 nf-text-13" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
                {item.isShortcut && <span className="nf-text-11 nf-text-muted">（ショートカット）</span>}
              </span>
              {formatUpdated(item.updated) && (
                <span className="nf-text-11 nf-text-muted">{formatUpdated(item.updated)}</span>
              )}
              {item.type === "folder" && view !== "shared" && (
                <button
                  type="button"
                  className="nf-btn nf-text-11"
                  style={{ padding: "2px 8px" }}
                  onClick={(event) => { event.stopPropagation(); descend(item); }}
                >
                  開く
                </button>
              )}
            </div>
          );
        })}
      </div>

      {truncated && (
        <div className="nf-text-11 nf-text-muted">
          表示件数が上限に達したため一部のみ表示しています。検索で絞り込んでください。
        </div>
      )}
    </BaseDialog>
  );
}
