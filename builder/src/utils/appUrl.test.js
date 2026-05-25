import assert from "node:assert/strict";
import test from "node:test";
import { buildAppUrl, applyInitialHashFromGas } from "./appUrl.js";

function withWindow(stub, fn) {
  const prev = globalThis.window;
  globalThis.window = stub;
  try { return fn(); } finally {
    if (prev === undefined) delete globalThis.window;
    else globalThis.window = prev;
  }
}

test("buildAppUrl: __GAS_WEBAPP_URL__ がある場合は ?route= を付ける (iframe にハッシュが届かないため)", () => {
  withWindow(
    { __GAS_WEBAPP_URL__: "https://script.google.com/macros/s/AKfycb.../exec", location: { origin: "https://other", pathname: "/x", search: "" } },
    () => {
      assert.equal(
        buildAppUrl("/admin/questions/abc"),
        "https://script.google.com/macros/s/AKfycb.../exec?route=%2Fadmin%2Fquestions%2Fabc"
      );
    }
  );
});

test("buildAppUrl: __GAS_WEBAPP_URL__ が無い場合は window.location を base にして #/... を返す", () => {
  withWindow(
    { location: { origin: "http://localhost:5173", pathname: "/", search: "" } },
    () => {
      assert.equal(buildAppUrl("/admin/questions/abc"), "http://localhost:5173/#/admin/questions/abc");
    }
  );
});

test("buildAppUrl: GAS base にすでに hash があれば取り除いてから ?route= を付ける", () => {
  withWindow(
    { __GAS_WEBAPP_URL__: "https://script.google.com/macros/s/AKfycb.../exec#/admin/dashboards/x/edit" },
    () => {
      assert.equal(
        buildAppUrl("/admin/questions/abc"),
        "https://script.google.com/macros/s/AKfycb.../exec?route=%2Fadmin%2Fquestions%2Fabc"
      );
    }
  );
});

test("buildAppUrl: 先頭の # を保持しても重複しない (GAS 経由)", () => {
  withWindow(
    { __GAS_WEBAPP_URL__: "https://example.com/exec" },
    () => {
      assert.equal(buildAppUrl("#/foo"), "https://example.com/exec?route=%2Ffoo");
    }
  );
});

test("buildAppUrl: 先頭スラッシュ無しでも # と / を補う (dev)", () => {
  withWindow(
    { location: { origin: "http://localhost:5173", pathname: "/", search: "" } },
    () => {
      assert.equal(buildAppUrl("foo/bar"), "http://localhost:5173/#/foo/bar");
    }
  );
});

test("buildAppUrl: dev で search 部分も保持する", () => {
  withWindow(
    { location: { origin: "http://localhost:5173", pathname: "/", search: "?form=xxx" } },
    () => {
      assert.equal(buildAppUrl("/admin/questions/abc"), "http://localhost:5173/?form=xxx#/admin/questions/abc");
    }
  );
});

test("buildAppUrl: GAS URL に既に ?form=xxx がある場合は & で連結する", () => {
  withWindow(
    { __GAS_WEBAPP_URL__: "https://script.google.com/macros/s/AKfycb.../exec?form=xyz" },
    () => {
      assert.equal(
        buildAppUrl("/admin/questions/abc"),
        "https://script.google.com/macros/s/AKfycb.../exec?form=xyz&route=%2Fadmin%2Fquestions%2Fabc"
      );
    }
  );
});

test("applyInitialHashFromGas: __INITIAL_HASH__ を window.location.hash に書き戻す", () => {
  const calls = [];
  withWindow(
    {
      __INITIAL_HASH__: "/admin/questions/abc",
      location: { hash: "", pathname: "/exec", search: "" },
      history: { replaceState: (...args) => calls.push(args) },
    },
    () => {
      applyInitialHashFromGas();
      assert.equal(calls.length, 1);
      assert.equal(calls[0][2], "/exec#/admin/questions/abc");
    }
  );
});

test("applyInitialHashFromGas: 既に hash があれば上書きしない", () => {
  const calls = [];
  withWindow(
    {
      __INITIAL_HASH__: "/admin/questions/abc",
      location: { hash: "#/some/existing/path", pathname: "/exec", search: "" },
      history: { replaceState: (...args) => calls.push(args) },
    },
    () => {
      applyInitialHashFromGas();
      assert.equal(calls.length, 0);
    }
  );
});

test("applyInitialHashFromGas: hash が #/ だけのときは上書き対象 (RGL/HashRouter のデフォルト)", () => {
  const calls = [];
  withWindow(
    {
      __INITIAL_HASH__: "/admin/questions/abc",
      location: { hash: "#/", pathname: "/exec", search: "" },
      history: { replaceState: (...args) => calls.push(args) },
    },
    () => {
      applyInitialHashFromGas();
      assert.equal(calls.length, 1);
      assert.equal(calls[0][2], "/exec#/admin/questions/abc");
    }
  );
});

test("applyInitialHashFromGas: __INITIAL_HASH__ が空なら何もしない", () => {
  const calls = [];
  withWindow(
    {
      __INITIAL_HASH__: "",
      location: { hash: "", pathname: "/exec", search: "" },
      history: { replaceState: (...args) => calls.push(args) },
    },
    () => {
      applyInitialHashFromGas();
      assert.equal(calls.length, 0);
    }
  );
});

test("applyInitialHashFromGas: 先頭スラッシュ・# が無い値でも正規化して反映する", () => {
  const calls = [];
  withWindow(
    {
      __INITIAL_HASH__: "admin/questions/abc",
      location: { hash: "", pathname: "/exec", search: "?form=xx" },
      history: { replaceState: (...args) => calls.push(args) },
    },
    () => {
      applyInitialHashFromGas();
      assert.equal(calls.length, 1);
      assert.equal(calls[0][2], "/exec?form=xx#/admin/questions/abc");
    }
  );
});
