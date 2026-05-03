/**
 * ブラウザ側 ULID 生成（GAS 側 Nfb_generateUlid_ の JS 版）
 */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(unixMs) {
  let value = Math.floor(unixMs);
  const chars = new Array(10);
  for (let i = 9; i >= 0; i--) {
    chars[i] = ULID_ALPHABET[value % 32];
    value = Math.floor(value / 32);
  }
  return chars.join("");
}

function encodeRandom(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let encoded = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += ULID_ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
      if (bits === 0) buffer = 0;
      else buffer = buffer & ((1 << bits) - 1);
    }
  }
  if (bits > 0) encoded += ULID_ALPHABET[(buffer << (5 - bits)) & 31];
  return encoded.substring(0, 16);
}

function generateUlid() {
  return encodeTime(Date.now()) + encodeRandom(10);
}

export function generateQuestionId() {
  return "q_" + generateUlid();
}

export function generateDashboardId() {
  return "d_" + generateUlid();
}

export function generateCardId() {
  return "card_" + generateUlid();
}
