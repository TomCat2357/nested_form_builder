import assert from "node:assert/strict";
import { test } from "node:test";
import { runWithSaveRetry_ } from "./formPageSaveHandler.js";
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../core/constants.js";

const lockTimeoutError = () => {
  const error = new Error("ロック取得に失敗しました");
  error.code = GAS_ERROR_CODE_LOCK_TIMEOUT;
  return error;
};

const collectAlerts = () => {
  const calls = [];
  const showAlert = (message, title) => calls.push({ message, title });
  return { calls, showAlert };
};

// waitFn はテストで実際に待たないスタブ（呼び出し回数だけ記録）
const makeWaitSpy = () => {
  const waited = [];
  const waitFn = async (ms) => {
    waited.push(ms);
  };
  return { waited, waitFn };
};

test("初回成功ならアラートを出さない", async () => {
  let attempts = 0;
  const { calls, showAlert } = collectAlerts();
  const { waited, waitFn } = makeWaitSpy();

  const result = await runWithSaveRetry_({
    attemptSave: async () => {
      attempts += 1;
    },
    showAlert,
    waitFn,
    maxAttempts: 3,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 1);
  assert.equal(calls.length, 0);
  assert.equal(waited.length, 0);
});

test("LOCK_TIMEOUT で一旦失敗しても、リトライで成功すればアラートを出さない", async () => {
  let attempts = 0;
  const { calls, showAlert } = collectAlerts();
  const { waited, waitFn } = makeWaitSpy();

  const result = await runWithSaveRetry_({
    attemptSave: async () => {
      attempts += 1;
      if (attempts < 3) throw lockTimeoutError();
    },
    showAlert,
    waitFn,
    maxAttempts: 3,
    retryIntervalMs: 1000,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 3);
  assert.equal(calls.length, 0, "成功時はアラートを出さない");
  assert.deepEqual(waited, [1000, 1000], "失敗 2 回ぶん待機している");
});

test("全リトライ枯渇 (常に LOCK_TIMEOUT) なら、ローカル保存済みの正確な文言で 1 度だけ通知する", async () => {
  let attempts = 0;
  const { calls, showAlert } = collectAlerts();
  const { waited, waitFn } = makeWaitSpy();

  const result = await runWithSaveRetry_({
    attemptSave: async () => {
      attempts += 1;
      throw lockTimeoutError();
    },
    showAlert,
    waitFn,
    maxAttempts: 3,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, GAS_ERROR_CODE_LOCK_TIMEOUT);
  // maxAttempts=3 → attempt 0..3 の計 4 回試行
  assert.equal(attempts, 4);
  assert.equal(waited.length, 3, "最後の試行後は待機しない");
  assert.equal(calls.length, 1, "アラートは 1 度だけ");
  assert.match(calls[0].message, /ローカルには保存しました/);
  assert.match(calls[0].message, /次回の同期で自動的に再試行します/);
  assert.equal(calls[0].title, "スプレッドシートへの反映を保留しました");
});

test("リトライ不能なエラー（LOCK_TIMEOUT 以外）は即座に汎用アラートを出し、リトライしない", async () => {
  let attempts = 0;
  const { calls, showAlert } = collectAlerts();
  const { waited, waitFn } = makeWaitSpy();

  const result = await runWithSaveRetry_({
    attemptSave: async () => {
      attempts += 1;
      throw new Error("予期しないエラー");
    },
    showAlert,
    waitFn,
    maxAttempts: 3,
  });

  assert.equal(result.ok, false);
  assert.equal(attempts, 1, "リトライ不能なら再試行しない");
  assert.equal(waited.length, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].message, /スプレッドシート保存に失敗しました/);
  assert.match(calls[0].message, /予期しないエラー/);
});
