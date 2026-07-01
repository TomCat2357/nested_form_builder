import React, { useCallback } from "react";
import {
  listQuestions,
  listQuestionsSWR,
  saveQuestion,
  archiveQuestions,
  unarchiveQuestions,
  copyQuestion,
  deleteQuestions,
  deleteQuestionsWithFiles,
  exportQuestions,
  importQuestionsFromDrive,
  registerImportedQuestion,
  listQuestionFolders,
  createQuestionFolder,
  moveQuestions,
  renameQuestionFolder,
  deleteQuestionFolder,
} from "../../features/analytics/analyticsStore.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import AdminAnalyticsListPage from "./AdminAnalyticsListPage.jsx";

const store = {
  list: listQuestions,
  listSWR: listQuestionsSWR,
  save: saveQuestion,
  archive: archiveQuestions,
  unarchive: unarchiveQuestions,
  copy: copyQuestion,
  remove: deleteQuestions,
  removeWithFiles: deleteQuestionsWithFiles,
  exportItems: exportQuestions,
  importFromDrive: importQuestionsFromDrive,
  registerImported: registerImportedQuestion,
  listFolders: listQuestionFolders,
  createFolder: createQuestionFolder,
  moveItems: moveQuestions,
  renameFolder: renameQuestionFolder,
  deleteFolder: deleteQuestionFolder,
};

const extraColumn = {
  header: "種別",
  render: (q) => (q.query?.mode === "sql" ? "SQL" : q.query?.mode === "gui" ? "GUI" : "---"),
};

export default function AdminQuestionListPage() {
  const { refreshForms } = useAppData();

  // Question は Form に依存するため、更新は Form 一覧も丸ごと再取得する。
  const cascadeRefresh = useCallback(
    () => refreshForms({ reason: "cascade:admin-question-list", background: true }),
    [refreshForms],
  );

  return (
    <AdminAnalyticsListPage
      kind="questions"
      itemLabel="Question"
      title="Question 管理"
      fallbackPath="/admin"
      newItemPath="/admin/questions/new"
      buildEditPath={(id) => `/admin/questions/${id}`}
      store={store}
      extraColumn={extraColumn}
      cascadeRefresh={cascadeRefresh}
    />
  );
}
