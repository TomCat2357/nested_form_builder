import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

const files = [
  'C:/Users/sa11882/nested_form_builder/form_test/鳥獣保護管理法様式_法人想定.xlsx',
  'C:/Users/sa11882/nested_form_builder/form_test/鳥獣保護管理法様式_個人想定.xlsx'
];

async function analyzeFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  const name = path.basename(filePath);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`FILE: ${name}`);
  console.log('='.repeat(80));
  
  workbook.worksheets.forEach((worksheet, idx) => {
    console.log(`\n--- Sheet ${idx + 1}: "${worksheet.name}" ---`);
    console.log(`Dimensions: ${worksheet.dimensions?.toString() || 'empty'}`);
    
    // Find cells with fill colors
    const coloredCells = [];
    worksheet.eachRow((row, rowNum) => {
      row.eachCell((cell, colNum) => {
        if (cell.fill && cell.fill.type === 'pattern') {
          const color = cell.fill.fgColor?.argb || cell.fill.fgColor?.theme;
          if (color && color !== '00000000' && color !== 'FFFFFFFF') {
            coloredCells.push({
              cell: cell.address,
              value: cell.value,
              argb: color,
              type: cell.fill.patternType
            });
          }
        }
      });
    });
    
    if (coloredCells.length > 0) {
      console.log(`\nCells with fill colors (${coloredCells.length} total):`);
      coloredCells.slice(0, 50).forEach(item => {
        console.log(`  ${item.cell}: "${item.value}" | Color: ${item.argb} | Pattern: ${item.type}`);
      });
      if (coloredCells.length > 50) {
        console.log(`  ... and ${coloredCells.length - 50} more`);
      }
    } else {
      console.log('No colored cells found');
    }
    
    // Show first few rows with data
    console.log(`\nFirst 10 rows of data:`);
    let rowCount = 0;
    worksheet.eachRow((row, rowNum) => {
      if (rowCount >= 10) return;
      const values = row.values?.filter(v => v != null).slice(0, 10) || [];
      if (values.length > 0) {
        console.log(`  Row ${rowNum}: ${JSON.stringify(values)}`);
        rowCount++;
      }
    });
  });
}

(async () => {
  for (const file of files) {
    try {
      await analyzeFile(file);
    } catch (err) {
      console.error(`Error reading ${file}:`, err.message);
    }
  }
})();
