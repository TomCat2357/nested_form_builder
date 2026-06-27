import fs from 'fs';

const files = [
  { path: 'C:/Users/sa11882/nested_form_builder/form_test/従事者情報.json', name: '従事者情報' },
  { path: 'C:/Users/sa11882/nested_form_builder/form_test/鳥獣保護管理法許可申請.json', name: '許可申請' }
];

files.forEach(file => {
  const content = fs.readFileSync(file.path, 'utf8');
  const data = JSON.parse(content);
  console.log(`${file.name}: id="${data.id || 'N/A'}"`);
});
