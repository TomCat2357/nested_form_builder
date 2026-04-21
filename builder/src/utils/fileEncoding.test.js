import assert from "node:assert/strict";
import { test } from "node:test";
import { blobToBase64, fileToBase64 } from "./fileEncoding.js";

test("blobToBase64 は既知のバイト列を正しい Base64 に変換する", async () => {
  const blob = new Blob([new Uint8Array([0, 1, 2, 255])]);
  assert.equal(await blobToBase64(blob), "AAEC/w==");
});

test("blobToBase64 は空 Blob に対して空文字を返す", async () => {
  const blob = new Blob([]);
  assert.equal(await blobToBase64(blob), "");
});

test("blobToBase64 は ASCII テキストを正しく変換する", async () => {
  const blob = new Blob(["Hello"]);
  assert.equal(await blobToBase64(blob), "SGVsbG8=");
});

test("blobToBase64 は 1 KB のバイナリをデコード可能な Base64 に変換する", async () => {
  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
  const blob = new Blob([bytes]);
  const encoded = await blobToBase64(blob);
  const decoded = Buffer.from(encoded, "base64");
  assert.equal(decoded.length, 1024);
  for (let i = 0; i < decoded.length; i += 1) {
    assert.equal(decoded[i], i % 256);
  }
});

test("fileToBase64 は blobToBase64 の別名として機能する", () => {
  assert.equal(fileToBase64, blobToBase64);
});
