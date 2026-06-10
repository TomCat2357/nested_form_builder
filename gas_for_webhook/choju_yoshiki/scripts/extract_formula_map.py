# -*- coding: utf-8 -*-
"""鳥獣保護管理法様式.xlsx から mapping.gs 起こし用の素材を抽出する一回限りの開発補助。

出力 (scripts/out/):
  formulas.tsv      シート名 \t セル番地 \t 数式      … 転記対象セルの機械列挙
  merges.tsv        シート名 \t 結合レンジ            … 左上番地の検証用
  number_formats.tsv シート名 \t セル番地 \t 表示形式  … 日付セル (Date 書き込み先) の確認用
  plain_values.tsv  シート名 \t セル番地 \t 値        … 固定文言・サンプル値の参照用

使い方: form_data/鳥獣保護管理法様式.xlsx を読める場所で
  python extract_formula_map.py [xlsx パス]
"""
import os
import sys

import openpyxl

DEFAULT_XLSX = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "form_data", "鳥獣保護管理法様式.xlsx"
)


def main():
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    out_dir = os.path.join(os.path.dirname(__file__), "out")
    os.makedirs(out_dir, exist_ok=True)

    wb = openpyxl.load_workbook(xlsx_path, data_only=False)

    formulas = []
    merges = []
    numfmts = []
    plains = []
    for ws in wb.worksheets:
        for rng in ws.merged_cells.ranges:
            merges.append((ws.title, str(rng)))
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    formulas.append((ws.title, cell.coordinate, cell.value))
                else:
                    plains.append((ws.title, cell.coordinate, str(cell.value).replace("\n", "⏎")))
                fmt = cell.number_format
                if fmt and fmt != "General":
                    numfmts.append((ws.title, cell.coordinate, fmt))

    def dump(name, rows):
        path = os.path.join(out_dir, name)
        with open(path, "w", encoding="utf-8", newline="") as f:
            for r in rows:
                f.write("\t".join(r) + "\n")
        print(f"{name}: {len(rows)} rows")

    dump("formulas.tsv", formulas)
    dump("merges.tsv", merges)
    dump("number_formats.tsv", numfmts)
    dump("plain_values.tsv", plains)


if __name__ == "__main__":
    main()
