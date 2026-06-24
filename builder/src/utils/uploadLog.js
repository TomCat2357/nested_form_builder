/**
 * オフラインファースト保存（uploadQueue / uploadWorker）の診断ログ。
 *
 * 「未アップロードのフォーム/クエスチョン/ダッシュボードあり」が解決しないとき、
 * 「どこの・何が・なぜ詰まっているか」を console から追えるようにするための薄いロガー。
 * perfLogger.js と同じ方針で、import.meta.env.DEV のときだけ verbose を既定 ON にし、
 * 本番ビルドでは黙る（CLAUDE.md「本番で console.log を残さない」を満たす）。
 *
 * 使い方:
 *   uploadLog.logVerbose("enqueue", "save job", { entityType, localId });
 *   uploadLog.warn("run", "fail", { jobId, message });   // 失敗の本パスは verbose 非依存で出す
 * トグル:
 *   window.uploadDebug.setVerbose(true)   // 本番でも一時的に詳細ログを見たいとき
 *   window.uploadDebug.setVerbose(false)
 */

const resolveDefaultVerbose = () => {
  try {
    return Boolean(import.meta?.env?.DEV);
  } catch {
    return false;
  }
};

class UploadLogger {
  constructor({ verbose = resolveDefaultVerbose() } = {}) {
    this.verbose = !!verbose;
  }

  setVerbose(enabled) {
    this.verbose = !!enabled;
  }

  isVerbose() {
    return this.verbose;
  }

  // verbose のときだけ出す詳細ログ（正常系の「どこの・何」を追う用）。
  logVerbose(scope, message, payload) {
    if (!this.verbose) return;
    const prefix = scope ? `[upload][${scope}]` : "[upload]";
    if (payload === undefined) {
      console.log(`${prefix} ${message}`);
      return;
    }
    console.log(`${prefix} ${message}`, payload);
  }

  // 失敗の本パスは verbose に関係なく出す（「なぜできなかったか」を常に残す）。
  warn(scope, message, payload) {
    const prefix = scope ? `[upload][${scope}]` : "[upload]";
    if (payload === undefined) {
      console.warn(`${prefix} ${message}`);
      return;
    }
    console.warn(`${prefix} ${message}`, payload);
  }

  error(scope, message, payload) {
    const prefix = scope ? `[upload][${scope}]` : "[upload]";
    if (payload === undefined) {
      console.error(`${prefix} ${message}`);
      return;
    }
    console.error(`${prefix} ${message}`, payload);
  }
}

export const uploadLog = new UploadLogger();

// 本番でも window.uploadDebug.setVerbose(true) で一時的に詳細ログを有効化できる。
if (typeof window !== "undefined") {
  window.uploadDebug = uploadLog;
  uploadLog.logVerbose("logger", "window.uploadDebug.setVerbose(true/false) で詳細ログを切り替えできます");
}
