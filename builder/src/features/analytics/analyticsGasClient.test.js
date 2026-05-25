import test from "node:test";
import assert from "node:assert/strict";
import { analyticsGasClient } from "./analyticsGasClient.js";

const expectedMethods = (entity) => [
  `list${entity}s`, `get${entity}`, `save${entity}`,
  `delete${entity}`, `delete${entity}s`,
  `archive${entity}`, `unarchive${entity}`, `archive${entity}s`, `unarchive${entity}s`,
  `copy${entity}`, `import${entity}sFromDrive`, `registerImported${entity}`,
];

test("Question / Dashboard の CRUD メソッドが揃っている", () => {
  for (const name of [...expectedMethods("Question"), ...expectedMethods("Dashboard")]) {
    assert.equal(typeof analyticsGasClient[name], "function", `missing: ${name}`);
  }
});

test("各メソッドは正しい GAS 関数名と引数で呼ぶ", async () => {
  const calls = [];
  globalThis.google = {
    script: {
      run: {
        withSuccessHandler(fn) { this._ok = fn; return this; },
        withFailureHandler(fn) { this._fail = fn; return this; },
      },
    },
  };
  // 動的に各 nfb 関数を登録：呼ばれたら記録して { ok: true } を返す
  const runner = globalThis.google.script.run;
  const proxy = new Proxy(runner, {
    get(target, prop, recv) {
      if (prop in target) return Reflect.get(target, prop, recv);
      return (...args) => { calls.push({ fn: String(prop), args }); target._ok({ ok: true }); };
    },
  });
  globalThis.google.script.run = proxy;

  await analyticsGasClient.listQuestions({ a: 1 });
  await analyticsGasClient.getDashboard("d_1");
  await analyticsGasClient.saveQuestion({ id: "q_1" }, "https://x/folders/abc");
  await analyticsGasClient.deleteDashboards(["d_1", "d_2"]);
  await analyticsGasClient.archiveQuestion("q_1");
  await analyticsGasClient.registerImportedDashboard({ p: 1 });

  assert.deepEqual(calls[0], { fn: "nfbListAnalyticsQuestions", args: [{ a: 1 }] });
  assert.deepEqual(calls[1], { fn: "nfbGetAnalyticsDashboard", args: ["d_1"] });
  assert.deepEqual(calls[2], { fn: "nfbSaveAnalyticsQuestion", args: [{ question: { id: "q_1" }, targetUrl: "https://x/folders/abc" }] });
  assert.deepEqual(calls[3], { fn: "nfbDeleteAnalyticsDashboards", args: [["d_1", "d_2"]] });
  assert.deepEqual(calls[4], { fn: "nfbArchiveAnalyticsQuestion", args: ["q_1"] });
  assert.deepEqual(calls[5], { fn: "nfbRegisterImportedAnalyticsDashboard", args: [{ p: 1 }] });

  delete globalThis.google;
});
