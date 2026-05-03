/**
 * GAS API クライアント（analytics 系）
 * gasClient.js のパターン踏襲
 */

function callScriptRun_(functionName, ...args) {
  return new Promise((resolve, reject) => {
    const runner = google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject);
    runner[functionName](...args);
  });
}

async function fetchAnalyticsApi_(functionName, args, errorMessage) {
  let result;
  try {
    result = await callScriptRun_(functionName, ...args);
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(errorMessage + ": " + msg);
  }
  if (!result || !result.ok) {
    throw new Error(result?.error || errorMessage);
  }
  return result;
}

export const analyticsGasClient = {
  async getSnapshot({ spreadsheetId, sheetName, formId, includeDeleted = false }) {
    return fetchAnalyticsApi_(
      "nfbGetAnalyticsSnapshot",
      [{ spreadsheetId, sheetName, formId, includeDeleted }],
      "スナップショット取得に失敗しました"
    );
  },

  async checkSnapshotVersion({ spreadsheetId, sheetName, formId }) {
    return fetchAnalyticsApi_(
      "nfbCheckAnalyticsSnapshotVersion",
      [{ spreadsheetId, sheetName, formId }],
      "バージョン確認に失敗しました"
    );
  },

  async listQuestions() {
    return fetchAnalyticsApi_("nfbListAnalyticsQuestions", [], "Question 一覧取得に失敗しました");
  },

  async getQuestion(questionId) {
    return fetchAnalyticsApi_("nfbGetAnalyticsQuestion", [questionId], "Question 取得に失敗しました");
  },

  async saveQuestion(question) {
    return fetchAnalyticsApi_(
      "nfbSaveAnalyticsQuestion",
      [{ question }],
      "Question 保存に失敗しました"
    );
  },

  async deleteQuestion(questionId) {
    return fetchAnalyticsApi_("nfbDeleteAnalyticsQuestion", [questionId], "Question 削除に失敗しました");
  },

  async listDashboards() {
    return fetchAnalyticsApi_("nfbListAnalyticsDashboards", [], "Dashboard 一覧取得に失敗しました");
  },

  async getDashboard(dashboardId) {
    return fetchAnalyticsApi_("nfbGetAnalyticsDashboard", [dashboardId], "Dashboard 取得に失敗しました");
  },

  async saveDashboard(dashboard) {
    return fetchAnalyticsApi_(
      "nfbSaveAnalyticsDashboard",
      [{ dashboard }],
      "Dashboard 保存に失敗しました"
    );
  },

  async deleteDashboard(dashboardId) {
    return fetchAnalyticsApi_("nfbDeleteAnalyticsDashboard", [dashboardId], "Dashboard 削除に失敗しました");
  },
};
