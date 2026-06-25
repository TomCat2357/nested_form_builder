# -*- coding: utf-8 -*-
"""想定 xlsx（個人/法人）の 7 シートのキャッシュ値を JSON 化する（node 往復テスト用 fixture）。

出力: scripts/out/fixtures.json  = { "個人": { sheet: 2D配列 }, "法人": {...} }
日付セルは "YYYY-MM-DD" 文字列に正規化（Combined.gs のリーダがそのまま解釈する）。

使い方: python dump_fixtures.py
"""
import os, json, datetime, warnings
import openpyxl
warnings.filterwarnings("ignore")

REPO_FORM_TEST = os.path.join(os.path.dirname(__file__), "..", "..", "..", "form_test")
SHEETS = ["申請書", "従事者名簿", "事由書", "許可証", "振興局宛通知", "警察宛通知", "従事者証"]
FILES = [("個人", "鳥獣保護管理法様式_個人想定.xlsx"), ("法人", "鳥獣保護管理法様式_法人想定.xlsx")]


def conv(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return v


def main():
    out = {}
    for label, fn in FILES:
        wb = openpyxl.load_workbook(os.path.join(REPO_FORM_TEST, fn), data_only=True)
        book = {}
        for s in SHEETS:
            ws = wb[s]
            book[s] = [[conv(c) for c in row] for row in ws.iter_rows(values_only=True)]
        out[label] = book
    out_dir = os.path.join(os.path.dirname(__file__), "out")
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, "fixtures.json")
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False)
    print("wrote", dest)


if __name__ == "__main__":
    main()
