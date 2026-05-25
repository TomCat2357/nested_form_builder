export function buildFormIndex(forms) {
  const byId = new Map();
  const byTitle = new Map();
  const list = Array.isArray(forms) ? forms.slice() : [];
  list.sort((a, b) => {
    const at = Number(a?.createdAtUnixMs || a?.createdAt || 0);
    const bt = Number(b?.createdAtUnixMs || b?.createdAt || 0);
    return at - bt;
  });
  for (const form of list) {
    if (!form || !form.id) continue;
    byId.set(String(form.id), form);
    const title = form.settings?.formTitle;
    if (title && !byTitle.has(title)) {
      byTitle.set(title, form);
    }
  }
  return { byId, byTitle };
}

export function resolveFormRef(token, index) {
  if (!token || !index) return null;
  const key = String(token);
  if (index.byTitle.has(key)) return index.byTitle.get(key);
  if (index.byId.has(key)) return index.byId.get(key);
  return null;
}
