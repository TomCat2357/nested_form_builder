#!/usr/bin/env python3
"""manual/user_manual_images/*.png の下端にできた「背景だけ」の余白を切り落とすツール。

GAS の画面キャプチャは React アプリのルートが min-height:100vh のため、
コンテンツが短いとその下にグラデーション背景だけの行が大量に残る。
コンテンツのある最終行を推定し、少しマージンを残して下を crop する。

判定: 行内に「十分に暗いピクセル」（カード枠 #e0e0e0≈輝度224 やテキスト・グラフなど）が
あれば、その行はコンテンツ持ち。背景グラデーション(≈242+)・白いカード内部(255)・
サイドバー右枠(≈232) のような明るい縦線では発火しない。

使い方:
  python scripts/crop_manual_images_bottom.py            # ドライラン（提案のみ表示）
  python scripts/crop_manual_images_bottom.py --apply    # 実際に上書き保存
  python scripts/crop_manual_images_bottom.py --apply a.png b.png   # ファイル指定
"""
import sys
import os
import glob
from PIL import Image

IMAGES_DIR = os.path.join(os.path.dirname(__file__), "..", "manual", "user_manual_images")

# 「コンテンツのピクセル」と判定する輝度の上限。
#   カード枠/テーブル罫線 #e0e0e0 ≈ 224  → 拾う
#   サイドバー右枠 ≈ 232 / 背景 ≈ 242+ / 白 255 → 拾わない
CONTENT_LUM_MAX = 225
# 左端から無視する幅（ページ端）
LEFT_IGNORE_PX = 2
# 右端から無視する幅（サンドボックス iframe の縁・スクロールバー）
RIGHT_IGNORE_PX = 18
# コンテンツ最終行の下に残すマージン
BOTTOM_MARGIN_PX = 28
# これ未満しか削れないならスキップ
MIN_TRIM_PX = 40


def _lum(p):
    r, g, b = p[:3]
    return (r * 54 + g * 183 + b * 19) >> 8


def find_content_bottom(img):
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()
    x0 = min(LEFT_IGNORE_PX, max(0, w - 1))
    x1 = max(x0 + 1, w - RIGHT_IGNORE_PX)
    span = x1 - x0
    # 最下行に届いている暗いピクセルが「細い縦線」（サイドバー枠/罫線）程度の本数しか
    # なければ、それは構造的な縦線とみなして判定から外す。チャートやモーダル背景のように
    # 横方向に広く暗い場合は外さない。
    bottom_dark = [x for x in range(x0, x1) if _lum(px[x, h - 1]) <= CONTENT_LUM_MAX]
    ignore = set(bottom_dark) if 0 < len(bottom_dark) <= max(6, span * 0.08) else set()
    xs = [x for x in range(x0, x1) if x not in ignore]
    for y in range(h - 1, -1, -1):
        for x in xs:
            if _lum(px[x, y]) <= CONTENT_LUM_MAX:
                return y
    return -1


def process(path, apply):
    img = Image.open(path)
    w, h = img.size
    bottom = find_content_bottom(img)
    new_h = min(h, bottom + 1 + BOTTOM_MARGIN_PX) if bottom >= 0 else h
    trim = h - new_h
    if trim < MIN_TRIM_PX:
        print(f"  skip  {os.path.basename(path):48s} {w}x{h}  (content bottom y={bottom}, trim {trim}px)")
        return False
    print(f"  CROP  {os.path.basename(path):48s} {w}x{h} -> {w}x{new_h}  (-{trim}px)")
    if apply:
        img.crop((0, 0, w, new_h)).save(path)
    return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply = "--apply" in sys.argv
    if args:
        files = [a if (os.path.isabs(a) or os.path.exists(a)) else os.path.join(IMAGES_DIR, a) for a in args]
    else:
        files = sorted(glob.glob(os.path.join(IMAGES_DIR, "*.png")))
    print(f"{'APPLY' if apply else 'DRY-RUN'}: {len(files)} files")
    n = 0
    for f in files:
        if process(f, apply):
            n += 1
    print(f"{'cropped' if apply else 'would crop'} {n} / {len(files)} files")


if __name__ == "__main__":
    main()
