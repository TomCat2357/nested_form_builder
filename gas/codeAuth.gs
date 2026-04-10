/**
 * codeAuth.gs
 * 認証・ユーザープロフィール解決
 */

function ResolveActiveUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || "";
  } catch (err) {
    return "";
  }
}

function ResolvePrimaryPersonField_(items) {
  if (!items?.length) return null;
  return items.find((item) => item?.metadata?.primary)
    || items.find((item) => item?.current)
    || items[0]
    || null;
}

function NormalizeProfilePhone_(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("0081")) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("81")) {
    digits = `0${digits.slice(2)}`;
  }

  return digits;
}

function ResolveActiveUserProfile_() {
  const emptyProfile = { displayName: "", affiliation: "", title: "", phone: "" };
  try {
    const person = People.People.get("people/me", { personFields: "names,organizations,phoneNumbers" });
    const primaryName = ResolvePrimaryPersonField_(person?.names);
    const primaryOrganization = ResolvePrimaryPersonField_(person?.organizations);
    const primaryPhone = ResolvePrimaryPersonField_(person?.phoneNumbers);

    const displayName = primaryName?.displayName ? String(primaryName.displayName).trim() : "";
    const affiliation = primaryOrganization?.department
      ? String(primaryOrganization.department).trim()
      : (primaryOrganization?.name ? String(primaryOrganization.name).trim() : "");
    const title = primaryOrganization?.title ? String(primaryOrganization.title).trim() : "";
    const phone = NormalizeProfilePhone_(primaryPhone?.value || primaryPhone?.canonicalForm || "");

    return { displayName, affiliation, title, phone };
  } catch (err) {
    return emptyProfile;
  }
}

function ResolveActiveUserDisplayName_() {
  return ResolveActiveUserProfile_().displayName;
}

function EscapeForInlineScript_(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/<\/script/gi, "<\\/script");
}
