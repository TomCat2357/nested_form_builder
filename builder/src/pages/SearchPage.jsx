import React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { useFormContext } from "../app/state/formContext.jsx";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import SearchSidebar from "../features/search/components/SearchSidebar.jsx";
import SearchTable from "../features/search/components/SearchTable.jsx";
import SearchPagination from "../features/search/components/SearchPagination.jsx";
import SearchDisplaySettingsDialog from "../features/search/components/SearchDisplaySettingsDialog.jsx";
import { useSearchPageState } from "../features/search/useSearchPageState.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";
import { runPurgeCheck } from "../services/gasClient.js";
import { recordOpen } from "../app/state/openHistoryStore.js";

export default function SearchPage() {
  const { getFormById, forms } = useAppData();
  const { settings, updateSetting } = useBuilderSettings({ applyGlobalTheme: false });
  // 検索の遅延時間が空欄（"" / 未設定）のときは手動検索モード（検索ボタン）。0 を含む数値は自動検索。
  const manualSearch = settings?.searchDebounceMs === "" || settings?.searchDebounceMs == null;
  const { isAdmin, userEmail, formId: scopedFormId } = useAuth();
  // 子フォームをオーバーレイで開いているときは、開いた元の親レコード id（pid）に
  // 等しい行だけを検索一覧に出す。Provider 外（通常ページ）では childPid="" で従来どおり全件。
  const formCtx = useFormContext();
  const inChildContext = !!formCtx?.inChildContext;
  const childPid = inChildContext ? String(formCtx.pid || "") : "";
  // 親レコードが表示専用・編集不可なら、子フォームの検索一覧も閲覧のみ（新規入力・削除を無効化）。
  const parentReadOnly = inChildContext && !!formCtx?.parentReadOnly;
  // 子フォームをオーバーレイで開いているときの「オーバーレイを閉じる」要求（dirty チェック付き close）。
  const onRequestClose = formCtx?.onRequestClose;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert, showOutputAlert } = useAlert();

  const {
    effectiveFormId,
    isScopedByAuth,
    form,
    normalizedSchema,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showUndeleteConfirm,
    setShowUndeleteConfirm,
    selectedEntries,
    exporting,
    isCreatingPrintDocument,
    showDeleted,
    setShowDeleted,
    displaySettingsDialog,
    query,
    page,
    activeSort,
    searchOverrides,
    updateOverride,
    TABLE_MAX_WIDTH,
    cellDisplayLimit,
    HIT_COLUMN_MIN_WIDTH,
    entries,
    displayColumns,
    displayHeaderRows,
    displayPagedEntries,
    formLinkChildCounts,
    loading,
    backgroundLoading,
    waitingForLock,
    useCache,
    lastSyncedAt,
    hasUnsynced,
    unsyncedCount,
    cacheDisabled,
    forceRefreshAll,
    sortedEntries,
    outputTargetRows,
    resolveSearchChildFormsForRows,
    resolveSearchChildStorageMeta,
    filterError,
    totalPages,
    totalEntries,
    startIndex,
    endIndex,
    badge,
    allSelectedAreDeleted,
    handleSearchChange,
    handleSortToggle,
    handlePageChange,
    handleRowClick,
    handleCreateNew,
    handleOpenFormConfig,
    handleBackToMain,
    toggleSelectEntry,
    selectAllEntries,
    handleDeleteSelected,
    handleUndeleteSelected,
    handleExportResults,
    handleCellAction,
    handleCreatePrintDocument,
    confirmDelete,
    confirmUndelete,
  } = useSearchPageState({
    searchParams,
    setSearchParams,
    location,
    navigate,
    showAlert,
    showOutputAlert,
    userEmail,
    scopedFormId,
    getFormById,
    forms,
    settings,
    childPid,
  });

  // フォームを「開いた」履歴を記録する（起動時の先行プリフェッチのランキング元）。
  // 子フォームのオーバーレイ表示（inChildContext）は実ユーザー操作の「開く」ではないため除外。
  // id ごとに 1 回だけ記録する（再レンダーでの多重カウントを防ぐ）。
  const lastRecordedFormIdRef = React.useRef(null);
  React.useEffect(() => {
    if (inChildContext) return;
    if (!effectiveFormId) return;
    if (lastRecordedFormIdRef.current === effectiveFormId) return;
    lastRecordedFormIdRef.current = effectiveFormId;
    recordOpen("form", effectiveFormId).catch(() => {});
  }, [effectiveFormId, inChildContext]);

  // 更新ボタン: 通常のリフレッシュに加え、期限切れソフトデリート行の purge を付帯起動する。
  // purge は付帯処理のため、失敗してもリフレッシュ自体は妨げない（握りつぶす）。
  const handleRefresh = React.useCallback(() => {
    const fid = form?.id || effectiveFormId;
    if (fid) {
      Promise.resolve(runPurgeCheck({ formId: fid })).catch(() => {});
    }
    forceRefreshAll();
  }, [form?.id, effectiveFormId, forceRefreshAll]);

  if (!effectiveFormId || !form) {
    return (
      <AppLayout themeOverride={form?.settings?.theme} title="検索" fallbackPath="/" backHidden={false}>
        <p className="search-empty">
          {isAdmin
            ? "フォームが選択されていません。メイン画面からフォームを選択してください。"
            : "フォームが見つかりません。正しいURLでアクセスしているか確認してください。"}
        </p>
      </AppLayout>
    );
  }

  return (
    <AppLayout themeOverride={form?.settings?.theme}       title={`検索 - ${form.settings?.formTitle || "(無題)"}`}
      fallbackPath="/"
      backHidden
      badge={badge}
      sidebarActions={(
        <>
          <SearchSidebar
          onBack={inChildContext && onRequestClose ? onRequestClose : handleBackToMain}
          showBack={inChildContext ? true : !isScopedByAuth}
          onCreate={handleCreateNew}
          onConfig={handleOpenFormConfig}
          onDelete={handleDeleteSelected}
          onUndelete={handleUndeleteSelected}
          isUndoDelete={isAdmin && allSelectedAreDeleted}
          onPrint={handleCreatePrintDocument}
          onRefresh={handleRefresh}
          onExport={handleExportResults}
          useCache={useCache}
          refreshBusy={loading || backgroundLoading || waitingForLock}
          refreshDisabled={waitingForLock}
          exporting={exporting}
          printing={isCreatingPrintDocument}
          selectedCount={selectedEntries.size}
          filteredCount={sortedEntries.length}
          readOnly={!!form?.readOnly || parentReadOnly}
          externalActions={form?.settings?.externalActions?.enabled ? form.settings.externalActions.search : null}
          formContext={{
            formId: form?.id,
            formName: form?.settings?.formTitle,
            spreadsheetId: normalizeSpreadsheetId(form?.settings?.spreadsheetId || ""),
            sheetName: form?.settings?.sheetName || "Data",
            driveFileUrl: form?.driveFileUrl || "",
            userEmail,
          }}
          form={form}
          normalizedSchema={normalizedSchema}
          outputTargetRows={outputTargetRows}
          searchChildFormsResolver={resolveSearchChildFormsForRows}
          searchChildStorageMetaResolver={resolveSearchChildStorageMeta}
          isAdmin={isAdmin}
        />
        </>
      )}
    >
      <SearchToolbar
        query={query}
        onChange={handleSearchChange}
        lastSyncedAt={lastSyncedAt}
        useCache={useCache}
        cacheDisabled={cacheDisabled}
        backgroundLoading={backgroundLoading}
        lockWaiting={waitingForLock}
        hasUnsynced={hasUnsynced}
        unsyncedCount={unsyncedCount}
        syncInProgress={loading || backgroundLoading || waitingForLock}
        onSettingsClick={() => displaySettingsDialog.open()}
        filterError={filterError}
        debounceMs={manualSearch ? 0 : (Number(settings?.searchDebounceMs) || 0)}
        manualSearch={manualSearch}
      />
      {isAdmin && (
        <div className="nf-row nf-gap-16 nf-items-center nf-mb-12 nf-wrap">
          <label className="nf-row nf-gap-6 nf-items-center">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
            <span className="nf-text-13">削除済みデータを表示する</span>
          </label>
        </div>
      )}

      {(waitingForLock || loading) && entries.length === 0 ? (
        <p className="search-loading">{waitingForLock ? "ロック解除待ち..." : "読み込み中..."}</p>
      ) : (
        <SearchTable
          columns={displayColumns}
          headerRows={displayHeaderRows}
          pagedEntries={displayPagedEntries}
          selectedEntries={selectedEntries}
          activeSort={activeSort}
          cellDisplayLimit={cellDisplayLimit}
          tableMaxWidth={TABLE_MAX_WIDTH}
          hitColumnMinWidth={HIT_COLUMN_MIN_WIDTH}
          formLinkChildCounts={formLinkChildCounts}
          onSortToggle={handleSortToggle}
          onSelectAll={selectAllEntries}
          onToggleSelect={toggleSelectEntry}
          onRowClick={handleRowClick}
          onCellAction={handleCellAction}
        />
      )}

      <SearchPagination
        page={page}
        totalPages={totalPages}
        totalEntries={totalEntries}
        startIndex={startIndex}
        endIndex={endIndex}
        onChange={handlePageChange}
      />

      <SearchDisplaySettingsDialog
        open={displaySettingsDialog.state.open}
        onClose={() => displaySettingsDialog.close()}
        overrides={searchOverrides}
        onUpdateOverride={updateOverride}
        formSettings={form?.settings}
        globalSettings={settings}
        globalDebounceMs={settings?.searchDebounceMs}
        onUpdateGlobalDebounce={(ms) => updateSetting("searchDebounceMs", ms)}
      />
      <ConfirmDialog
        open={showDeleteConfirm.open}
        title="レコードを削除"
        message={`選択した${showDeleteConfirm.entryIds.length}件の回答を削除します。よろしいですか？`}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setShowDeleteConfirm({ open: false, entryIds: [] }) },
          { label: "削除", value: "delete", variant: "danger", onSelect: confirmDelete },
        ]}
      />
      <ConfirmDialog
        open={showUndeleteConfirm.open}
        title="削除取消し"
        message={`選択した${showUndeleteConfirm.entryIds.length}件の削除済みデータを復活させます。よろしいですか？`}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setShowUndeleteConfirm({ open: false, entryIds: [] }) },
          { label: "削除取消し", value: "undelete", variant: "primary", onSelect: confirmUndelete },
        ]}
      />

</AppLayout>
  );
}
