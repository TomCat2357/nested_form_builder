import fs from 'fs';

const content = fs.readFileSync('C:/Users/sa11882/nested_form_builder/form_test/鳥獣保護管理法許可申請.json', 'utf8');
const data = JSON.parse(content);

// Find the formLink field
const formLinkField = data.schema.find(f => f.type === 'formLink');
if (formLinkField) {
  console.log('formLink field:');
  console.log(JSON.stringify(formLinkField, null, 2));
}

// Find upload fields
const uploadFields = data.schema.filter(f => f.type === 'uploadRecords' || f.type === 'upload');
if (uploadFields.length > 0) {
  console.log('\n\nUpload/uploadRecords fields:');
  uploadFields.forEach(f => {
    console.log(JSON.stringify(f, null, 2));
  });
}

console.log('\n\nAll schema field labels and types:');
data.schema.forEach((f, idx) => {
  console.log(`[${idx}] ${f.type}: "${f.label}"`);
});
