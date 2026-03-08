import test from "node:test";
import assert from "node:assert/strict";
import { getStandardPhonePlaceholder } from "./phone.js";

test("getStandardPhonePlaceholder は標準設定の例を返す", () => {
  assert.equal(
    getStandardPhonePlaceholder({
      phoneFormat: "hyphen",
      allowFixedLineOmitAreaCode: false,
      allowMobile: true,
      allowIpPhone: true,
      allowTollFree: true,
    }),
    "090-1234-5678 、 050-1234-5678 、 0120-123-456 、 011-211-2111 など",
  );
});

test("getStandardPhonePlaceholder はハイフンなし設定の例を返す", () => {
  assert.equal(
    getStandardPhonePlaceholder({
      phoneFormat: "plain",
      allowFixedLineOmitAreaCode: false,
      allowMobile: true,
      allowIpPhone: true,
      allowTollFree: true,
    }),
    "09012345678 、 05012345678 、 0120123456 、 0112112111 など",
  );
});

test("getStandardPhonePlaceholder は許容外の種別を除外する", () => {
  assert.equal(
    getStandardPhonePlaceholder({
      phoneFormat: "hyphen",
      allowFixedLineOmitAreaCode: false,
      allowMobile: false,
      allowIpPhone: true,
      allowTollFree: true,
    }),
    "050-1234-5678 、 0120-123-456 、 011-211-2111 など",
  );
});

test("getStandardPhonePlaceholder は市外局番省略設定に応じて固定電話例を切り替える", () => {
  assert.equal(
    getStandardPhonePlaceholder({
      phoneFormat: "hyphen",
      allowFixedLineOmitAreaCode: true,
      allowMobile: false,
      allowIpPhone: false,
      allowTollFree: false,
    }),
    "211-2111 など",
  );

  assert.equal(
    getStandardPhonePlaceholder({
      phoneFormat: "plain",
      allowFixedLineOmitAreaCode: true,
      allowMobile: false,
      allowIpPhone: false,
      allowTollFree: false,
    }),
    "2112111 など",
  );
});
