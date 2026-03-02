// Split from forms.gs



function Forms_buildSpreadsheetName_(form) {
  var base = "";
  if (form && form.settings && form.settings.formTitle) {
    base = String(form.settings.formTitle || "");
  }
  if (!base && form && form.id) {
    base = "form_" + form.id;
  }
  base = String(base || "Nested Form Builder");
  base = base.replace(/[\r\n]/g, " ").replace(/\//g, "-").trim();
  if (!base) {
    base = "Nested Form Builder";
  }
  var name = "NFB Responses - " + base;
  if (name.length > 120) {
    name = name.substring(0, 120);
  }
  return name;
}

