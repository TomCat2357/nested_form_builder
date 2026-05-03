function Forms_normalizeFormTitle_(rawTitle) {
  var s = (rawTitle == null) ? "" : String(rawTitle);
  s = s.replace(/[\s|]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) return "(名称未設定)";
  return s;
}

function Forms_makeUniqueFormTitle_(desiredTitle, existingTitles) {
  var base = Forms_normalizeFormTitle_(desiredTitle);
  var taken = {};
  if (existingTitles && typeof existingTitles.length === "number") {
    for (var i = 0; i < existingTitles.length; i++) {
      var t = existingTitles[i];
      if (t == null) continue;
      taken[String(t)] = true;
    }
  }
  if (!taken[base]) return base;
  var n = 1;
  while (taken[base + " (" + n + ")"]) n++;
  return base + " (" + n + ")";
}

if (typeof module !== "undefined") {
  module.exports = {
    Forms_normalizeFormTitle_: Forms_normalizeFormTitle_,
    Forms_makeUniqueFormTitle_: Forms_makeUniqueFormTitle_,
  };
}
