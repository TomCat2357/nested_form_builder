const BASE64_PAD_RE = /=+$/g;

const toBase64Url = (bytes) => {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(BASE64_PAD_RE, "");
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(BASE64_PAD_RE, "");
  }

  throw new Error("No base64 encoder available");
};

const toSixByteTimestamp = (unixMs) => {
  let value = Math.floor(Number(unixMs));
  if (!Number.isFinite(value) || value < 0) value = 0;
  const bytes = new Uint8Array(6);
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
};

const createRandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  if (globalThis?.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
};

const createCompactId = (prefix) => {
  const tsPart = toBase64Url(toSixByteTimestamp(Date.now()));
  const randomPart = toBase64Url(createRandomBytes(6));
  return `${prefix}_${tsPart}_${randomPart}`;
};

export const genFormId = () => createCompactId("f");
export const genRecordId = () => createCompactId("r");

export const genId = () => `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
