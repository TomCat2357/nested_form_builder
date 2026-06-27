import fs from 'fs';

const files = [
  { path: 'C:/Users/sa11882/nested_form_builder/form_test/従事者情報.json', name: '従事者情報' },
  { path: 'C:/Users/sa11882/nested_form_builder/form_test/鳥獣保護管理法許可申請.json', name: '鳥獣保護管理法許可申請' }
];

files.forEach(file => {
  const content = fs.readFileSync(file.path, 'utf8');
  const data = JSON.parse(content);
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`FILE: ${file.name}.json`);
  console.log('='.repeat(80));
  
  // Top-level keys
  console.log(`\nTop-level keys: ${Object.keys(data).join(', ')}`);
  
  // Check if it's a form definition (has 'schema') or record data
  if (data.schema) {
    console.log(`\nForm schema detected: YES`);
    console.log(`Number of top-level form fields: ${data.schema.length}`);
    
    // Sample first 3 field types
    console.log(`\nFirst 5 schema fields:`);
    data.schema.slice(0, 5).forEach((field, idx) => {
      const { type, label, id } = field;
      console.log(`  [${idx}] type="${type}" label="${label}" id="${id}"`);
      if (field.children) {
        console.log(`      └─ has ${field.children.length} children`);
      }
      if (field.childrenByValue) {
        console.log(`      └─ has childrenByValue: ${Object.keys(field.childrenByValue).join(', ')}`);
      }
    });
  } else {
    console.log(`\nForm schema detected: NO (appears to be record data)`);
  }
  
  // Check for upload fields / child records
  if (data.schema) {
    const uploadFields = data.schema.filter(f => f.type === 'upload' || f.type === 'uploadRecords');
    if (uploadFields.length > 0) {
      console.log(`\nUpload/record fields: ${uploadFields.length}`);
      uploadFields.forEach(f => {
        console.log(`  - ${f.label} (${f.type})`);
        if (f.childForm) {
          console.log(`    childForm: ${f.childForm}`);
        }
      });
    }
  }
  
  // Check for references to other forms (substitution fields)
  if (data.schema) {
    const subFields = data.schema
      .flatMap(f => [f, ...(f.children || []), ...(Object.values(f.childrenByValue || {}).flat())])
      .filter(f => f && f.type === 'substitution');
    
    if (subFields.length > 0) {
      console.log(`\nSubstitution/reference fields: ${subFields.length}`);
      subFields.slice(0, 5).forEach(f => {
        const match = f.templateText?.match(/\[([^\]]+)\]/g) || [];
        const formRef = f.templateText?.match(/FROM \[([^\]]+)\]/);
        console.log(`  - ${f.label}`);
        if (formRef) {
          console.log(`    references form: ${formRef[1]}`);
        }
      });
    }
  }
});
