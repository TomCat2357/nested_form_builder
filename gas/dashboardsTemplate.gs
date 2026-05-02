var DASHBOARDS_TEMPLATE_CACHE_TTL_SECONDS = 300;

function Dashboards_buildTemplateCacheKey_(fileId) {
  return "nfb_dash_template::" + String(fileId || "").trim();
}

function Dashboards_getTemplate_(templateUrl) {
  if (!templateUrl) {
    throw new Error("テンプレートURLが指定されていません");
  }
  var parsed = Forms_parseGoogleDriveUrl_(templateUrl);
  if (!parsed || parsed.type !== "file" || !parsed.id) {
    throw new Error("テンプレートURLからファイルIDを抽出できません");
  }

  var cacheKey = Dashboards_buildTemplateCacheKey_(parsed.id);
  var cache;
  try { cache = CacheService.getScriptCache(); } catch (_e) { cache = null; }
  if (cache) {
    var cached = cache.get(cacheKey);
    if (cached) {
      try {
        var parsedCache = JSON.parse(cached);
        if (parsedCache && typeof parsedCache.html === "string") {
          parsedCache.fromCache = true;
          return parsedCache;
        }
      } catch (_parseErr) {
        // cache corrupted; fall through
      }
    }
  }

  var html;
  var fileName;
  var fileUrl;
  try {
    var file = DriveApp.getFileById(parsed.id);
    html = file.getBlob().getDataAsString();
    fileName = file.getName();
    fileUrl = file.getUrl();
  } catch (err) {
    throw new Error("テンプレートファイルを読み込めません: " + nfbErrorToString_(err));
  }

  var payload = {
    html: html,
    fileId: parsed.id,
    fileName: fileName,
    fileUrl: fileUrl,
    fetchedAt: new Date().getTime(),
    fromCache: false,
  };

  if (cache) {
    try {
      var serialized = JSON.stringify(payload);
      if (serialized.length < 100000) {
        cache.put(cacheKey, serialized, DASHBOARDS_TEMPLATE_CACHE_TTL_SECONDS);
      }
    } catch (cacheErr) {
      Logger.log("[Dashboards_getTemplate_] cache put failed: " + cacheErr);
    }
  }

  return payload;
}
