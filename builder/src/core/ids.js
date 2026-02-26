const BASE64_PAD_RE = /=+$/g;
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RANDOM_LENGTH = 16;

let lastUlidTimeMs = -1;
let lastUlidRandomPart = "";

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

const encodeUlidTime = (unixMs) => {
  let value = Math.floor(Number(unixMs));
  if (!Number.isFinite(value) || value < 0) value = 0;
  let encoded = "";
  for (let i = 0; i < 10; i += 1) {
    encoded = ULID_ALPHABET[value % 32] + encoded;
    value = Math.floor(value / 32);
  }
  return encoded;
};

const encodeUlidRandom = (bytes) => {
  let encoded = "";
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < bytes.length; i += 1) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;

    while (bits >= 5) {
      encoded += ULID_ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
      if (bits === 0) {
        buffer = 0;
      } else {
        buffer &= (1 << bits) - 1;
      }
    }
  }

  if (bits > 0) {
    encoded += ULID_ALPHABET[(buffer << (5 - bits)) & 31];
  }

  return encoded;
};

const createUlidRandomPart = () => encodeUlidRandom(createRandomBytes(10)).slice(0, ULID_RANDOM_LENGTH);

const incrementBase32 = (value) => {
  const chars = String(value || "").padEnd(ULID_RANDOM_LENGTH, ULID_ALPHABET[0]).slice(0, ULID_RANDOM_LENGTH).split("");
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const currentIndex = ULID_ALPHABET.indexOf(chars[i]);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    if (safeIndex < ULID_ALPHABET.length - 1) {
      chars[i] = ULID_ALPHABET[safeIndex + 1];
      for (let j = i + 1; j < chars.length; j += 1) chars[j] = ULID_ALPHABET[0];
      return { value: chars.join(""), overflow: false };
    }
    chars[i] = ULID_ALPHABET[0];
  }
  return { value: chars.join(""), overflow: true };
};

const createUlid = () => {
  let nowMs = Math.floor(Number(Date.now()));
  if (!Number.isFinite(nowMs) || nowMs < 0) nowMs = 0;

  if (lastUlidTimeMs < 0 || nowMs > lastUlidTimeMs) {
    lastUlidTimeMs = nowMs;
    lastUlidRandomPart = createUlidRandomPart();
    return `${encodeUlidTime(lastUlidTimeMs)}${lastUlidRandomPart}`;
  }

  if (!lastUlidRandomPart || lastUlidRandomPart.length !== ULID_RANDOM_LENGTH) {
    lastUlidRandomPart = createUlidRandomPart();
  }

  const next = incrementBase32(lastUlidRandomPart);
  if (next.overflow) {
    lastUlidTimeMs += 1;
    lastUlidRandomPart = createUlidRandomPart();
  } else {
    lastUlidRandomPart = next.value;
  }

  return `${encodeUlidTime(lastUlidTimeMs)}${lastUlidRandomPart}`;
};

const createCompactId = (prefix) => {
  const ulidPart = createUlid();
  const randomPart = toBase64Url(createRandomBytes(6)).slice(0, 8);
  return `${prefix}_${ulidPart}_${randomPart}`;
};

export const genFormId = () => createCompactId("f");
export const genRecordId = () => createCompactId("r");

export const genId = () => `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
