import React from "react";
import {
  listQuestions,
  archiveQuestions,
  unarchiveQuestions,
  copyQuestion,
  deleteQuestions,
  exportQuestions,
  importQuestionsFromDrive,
  registerImportedQuestion,
  listQuestionFolders,
  createQuestionFolder,
  moveQuestions,
  deleteQuestionFolder,
} from "../../features/analytics/analyticsStore.js";
import AdminAnalyticsListPage from "./AdminAnalyticsListPage.jsx";

const store = {
  list: listQuestions,
  archive: archiveQuestions,
  unarchive: unarchiveQuestions,
  copy: copyQuestion,
  remove: deleteQuestions,
  exportItems: exportQuestions,
  importFromDrive: importQuestionsFromDrive,
  registerImported: registerImportedQuestion,
  listFolders: listQuestionFolders,
  createFolder: createQuestionFolder,
  moveItems: moveQuestions,
  deleteFolder: deleteQuestionFolder,
};

const extraColumn = {
  header: "種別",
  render: (q) => (q.query?.mode === "sql" ? "SQL" : q.query?.mode === "gui" ? "GUI" : "---"),
};

export default function AdminQuestionListPage() {
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
    />
  );
}
