import ExcelJS from 'exceljs';

async function analyzeColors() {
  const files = [
    { path: 'C:/Users/sa11882/nested_form_builder/form_test/鳥獣保護管理法様式_法人想定.xlsx', name: '法人想定' },
    { path: 'C:/Users/sa11882/nested_form_builder/form_test/鳥獣保護管理法様式_個人想定.xlsx', name: '個人想定' }
  ];

  for (const file of files) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`FILE: ${file.name}`);
    console.log('='.repeat(80));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file.path);
    
    workbook.worksheets.forEach((ws, wsIdx) => {
      console.log(`\n--- Sheet: "${ws.name}" ---`);
      
      // Categorize cells by color
      const colorMap = {};
      const cellsByColor = {};
      
      ws.eachRow((row, rowNum) => {
        row.eachCell((cell, colNum) => {
          if (cell.fill && cell.fill.type === 'pattern') {
            const color = cell.fill.fgColor?.argb || cell.fill.fgColor?.theme;
            if (color && color !== '00000000' && color !== 'FFFFFFFF') {
              if (!colorMap[color]) colorMap[color] = [];
              colorMap[color].push(cell.address);
              
              if (!cellsByColor[color]) cellsByColor[color] = [];
              cellsByColor[color].push({
                address: cell.address,
                value: cell.value,
                text: typeof cell.value === 'object' ? JSON.stringify(cell.value) : String(cell.value).substring(0, 40)
              });
            }
          }
        });
      });
      
      // Show color summary
      Object.entries(colorMap).forEach(([color, cells]) => {
        const colorName = 
          color === 'FFFFFF00' ? 'YELLOW' :
          color === 'FFEAD1DC' ? 'PINK' :
          color === 'FF00B050' ? 'GREEN' :
          color;
        
        console.log(`\n  Color ${colorName} (${color}): ${cells.length} cells`);
        console.log(`    Sample cells:`);
        cellsByColor[color].slice(0, 8).forEach(c => {
          console.log(`      ${c.address}: "${c.text}"`);
        });
        if (cellsByColor[color].length > 8) {
          console.log(`      ... and ${cellsByColor[color].length - 8} more`);
        }
      });
      
      // Show if there are PINK and YELLOW in same rows
      const pinkCells = cellsByColor['FFEAD1DC'] || [];
      const yellowCells = cellsByColor['FFFFFF00'] || [];
      
      const pinkRows = new Set(pinkCells.map(c => parseInt(c.address.match(/\d+/)[0])));
      const yellowRows = new Set(yellowCells.map(c => parseInt(c.address.match(/\d+/)[0])));
      
      const commonRows = [...pinkRows].filter(r => yellowRows.has(r));
      if (commonRows.length > 0) {
        console.log(`\n  PINK and YELLOW appear in same rows: ${commonRows.slice(0, 5).join(', ')}${commonRows.length > 5 ? '...' : ''}`);
      }
    });
  }
}

analyzeColors().catch(console.error);
