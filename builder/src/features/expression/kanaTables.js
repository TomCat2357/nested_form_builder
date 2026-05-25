/**
 * 半角カナ ⇔ 全角カナ マッピングテーブル。
 * registerNfbUdfs.js の ZEN / HAN UDF 実装で使用。
 */

export const HALF_TO_FULL_KANA = {
  "ｦ": "ヲ", "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ",
  "ｪ": "ェ", "ｫ": "ォ", "ｬ": "ャ", "ｭ": "ュ",
  "ｮ": "ョ", "ｯ": "ッ", "ｰ": "ー",
  "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ",
  "ｵ": "オ", "ｶ": "カ", "ｷ": "キ", "ｸ": "ク",
  "ｹ": "ケ", "ｺ": "コ", "ｻ": "サ", "ｼ": "シ",
  "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ", "ﾀ": "タ",
  "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ", "ﾄ": "ト",
  "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ",
  "ﾉ": "ノ", "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ",
  "ﾍ": "ヘ", "ﾎ": "ホ", "ﾏ": "マ", "ﾐ": "ミ",
  "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ", "ﾔ": "ヤ",
  "ﾕ": "ユ", "ﾖ": "ヨ", "ﾗ": "ラ", "ﾘ": "リ",
  "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ", "ﾜ": "ワ",
  "ﾝ": "ン",
};

export const DAKUTEN_MAP = {
  "カ": "ガ", "キ": "ギ", "ク": "グ", "ケ": "ゲ", "コ": "ゴ",
  "サ": "ザ", "シ": "ジ", "ス": "ズ", "セ": "ゼ", "ソ": "ゾ",
  "タ": "ダ", "チ": "ヂ", "ツ": "ヅ", "テ": "デ", "ト": "ド",
  "ハ": "バ", "ヒ": "ビ", "フ": "ブ", "ヘ": "ベ", "ホ": "ボ",
  "ウ": "ヴ",
};

export const HANDAKUTEN_MAP = {
  "ハ": "パ", "ヒ": "ピ", "フ": "プ", "ヘ": "ペ", "ホ": "ポ",
};

export const FULL_TO_HALF_KANA = {};
export const DAKUTEN_TO_HALF = {};
export const HANDAKUTEN_TO_HALF = {};

for (const k of Object.keys(HALF_TO_FULL_KANA)) {
  FULL_TO_HALF_KANA[HALF_TO_FULL_KANA[k]] = k;
}
for (const k of Object.keys(DAKUTEN_MAP)) {
  const halfBase = FULL_TO_HALF_KANA[k];
  if (halfBase) DAKUTEN_TO_HALF[DAKUTEN_MAP[k]] = halfBase + "ﾞ";
}
for (const k of Object.keys(HANDAKUTEN_MAP)) {
  const halfBase = FULL_TO_HALF_KANA[k];
  if (halfBase) HANDAKUTEN_TO_HALF[HANDAKUTEN_MAP[k]] = halfBase + "ﾟ";
}
