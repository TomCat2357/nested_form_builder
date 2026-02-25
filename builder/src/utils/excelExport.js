import ExcelJS from "exceljs";

export const getThemeColors = () => {
  if (typeof document === "undefined") return {};
  const style = getComputedStyle(document.documentElement);
  const get = (v) => style.getPropertyValue(v).trim();
  const toHex = (color) => {
    if (!color) return null;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(color)) {
      return "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    }
    if (/^#[0-9a-fA-F]{8}$/.test(color)) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const a = parseInt(color.slice(7, 9), 16) / 255;
      const blend = (c) => Math.round(c * a + 255 * (1 - a));
      return "#" + [blend(r), blend(g), blend(b)].map((c) => c.toString(16).padStart(2, "0")).join("");
    }
    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    const r = parseInt(m[1]);
    const g = parseInt(m[2]);
    const b = parseInt(m[3]);
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    const blend = (c) => Math.round(c * a + 255 * (1 - a));
    return "#" + [blend(r), blend(g), blend(b)].map((c) => c.toString(16).padStart(2, "0")).join("");
  };
  return {
    primary: toHex(get("--primary")),
    primarySoft: toHex(get("--primary-soft")),
    text: toHex(get("--text")),
    border: toHex(get("--border")),
    surface: toHex(get("--surface")),
  };
};

export const createExcelBlob = async (exportTable, themeColors) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Data");

  const primaryColor = (themeColors.primary || "#2f6fed").replace("#", "");
  const primarySoftColor = (themeColors.primarySoft || "#dbeafe").replace("#", "");
  const surfaceColor = (themeColors.surface || "#ffffff").replace("#", "");
  const borderColor = (themeColors.border || "#e6e8f0").replace("#", "");

  exportTable.headerRows.forEach((rowArray) => {
    const row = worksheet.addRow(rowArray);
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + primaryColor } };
      cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
      cell.border = {
        top: { style: "medium", color: { argb: "FF" + primaryColor } },
        left: { style: "medium", color: { argb: "FF" + primaryColor } },
        bottom: { style: "medium", color: { argb: "FF" + primaryColor } },
        right: { style: "medium", color: { argb: "FF" + primaryColor } }
      };
    });
  });

  exportTable.rows.forEach((rowArray, index) => {
    const row = worksheet.addRow(rowArray);
    const bgColor = index % 2 === 0 ? surfaceColor : primarySoftColor;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + bgColor } };
      cell.font = { color: { argb: "FF1A1A2E" } };
      cell.border = {
        top: { style: "thin", color: { argb: "FF" + borderColor } },
        left: { style: "thin", color: { argb: "FF" + borderColor } },
        bottom: { style: "thin", color: { argb: "FF" + borderColor } },
        right: { style: "thin", color: { argb: "FF" + borderColor } }
      };
    });
  });

  worksheet.columns = exportTable.columns.map(() => ({ width: 20 }));
  worksheet.views = [{ state: 'frozen', ySplit: exportTable.headerRows.length }];

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};
