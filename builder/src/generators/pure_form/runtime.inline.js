export const runtimeScript = () => {
  const script = `(function(){
  const CFG = window.__NFB_CONFIG__ || {};
  const schema = window.__NFB_SCHEMA__ || [];
  const responses = {};

  // Custom Alert Dialog
  function showCustomAlert(message, title){
    title = title || "通知";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;z-index:1000";
    const dialog = document.createElement("div");
    dialog.style.cssText = "width:min(420px,90vw);background:#fff;border-radius:12px;box-shadow:0 20px 45px rgba(15,23,42,0.25);padding:24px 24px 16px;display:flex;flex-direction:column;gap:16px";
    if(title){
      const h2 = document.createElement("h2");
      h2.textContent = title;
      h2.style.cssText = "margin:0;font-size:18px;font-weight:600";
      dialog.appendChild(h2);
    }
    if(message){
      const p = document.createElement("p");
      p.textContent = message;
      p.style.cssText = "margin:0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap";
      dialog.appendChild(p);
    }
    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
    const btn = document.createElement("button");
    btn.textContent = "OK";
    btn.type = "button";
    btn.style.cssText = "border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer;border:1px solid #CBD5E1;background:#2563EB;border-color:#2563EB;color:#fff";
    btn.onclick = function(){ document.body.removeChild(overlay); };
    footer.appendChild(btn);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function generateRecordId(){
    if (CFG.recordId && typeof CFG.recordId === "string") return CFG.recordId;
    if (window.crypto && typeof window.crypto.getRandomValues === "function"){
      const bytes = new Uint8Array(12);
      window.crypto.getRandomValues(bytes);
      return "r_" + Array.from(bytes).map(function(b){ return ("0" + b.toString(16)).slice(-2); }).join("");
    }
    return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function formatDateLocal(date){
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function formatTimeLocal(date){
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return hours + ":" + minutes;
  }

  function applyDefaultNow(fields){
    const now = new Date();
    (fields || []).forEach(function(field){
      if(["date","time"].includes(field.type) && field.defaultNow && (responses[field.id] === undefined || responses[field.id] === null)){
        responses[field.id] = field.type === "date" ? formatDateLocal(now) : formatTimeLocal(now);
      }
      if(field.childrenByValue){
        Object.keys(field.childrenByValue).forEach(function(key){
          applyDefaultNow(field.childrenByValue[key]);
        });
      }
    });
  }

  applyDefaultNow(schema);

  const recordId = generateRecordId();
  window.__NFB_RECORD_ID__ = recordId;

  if (CFG.formTitle) document.title = CFG.formTitle;

  function buildSafeRegex(pattern){
    if(!pattern) return { re: null, error: null };
    try { return { re: new RegExp(pattern), error: null }; }
    catch (err) { return { re: null, error: (err && err.message) || String(err) }; }
  }

  function validateByPattern(field, value){
    if(field.type !== "regex") return { ok: true, message: "" };
    const { re, error } = buildSafeRegex(field.pattern || "");
    if(error) return { ok: false, message: "正規表現が不正です: " + error };
    if(field.required && (value ?? "") === "") return { ok: false, message: "入力は必須です" };
    if((value ?? "") === "") return { ok: true, message: "" };
    if(!re) return { ok: true, message: "" };
    return re.test(String(value)) ? { ok: true, message: "" } : { ok: false, message: "入力がパターンに一致しません: /" + field.pattern + "/" };
  }

  function collectResponses(fields, source, prefix, out, orderList){
    (fields || []).forEach(function(field){
      const label = field.label || "";
      const base = prefix ? prefix + "|" + label : label;
      const value = source[field.id];

      if(field.type === "checkboxes" && Array.isArray(value)){
        value.forEach(function(lbl){
          const key = base + "|" + lbl;
          out[key] = "●";
          if(orderList) orderList.push(key);
          if(field.childrenByValue && field.childrenByValue[lbl]) collectResponses(field.childrenByValue[lbl], source, base + "|" + lbl, out, orderList);
        });
      } else if(field.type === "radio" || field.type === "select"){
        if(typeof value === "string" && value.length > 0){
          const key = base + "|" + value;
          out[key] = "●";
          if(orderList) orderList.push(key);
          if(field.childrenByValue && field.childrenByValue[value]) collectResponses(field.childrenByValue[value], source, base + "|" + value, out, orderList);
        }
      } else if(["text","textarea","number","regex","date","time"].includes(field.type)){
        if((value ?? "") !== ""){
          out[base] = value;
          if(orderList) orderList.push(base);
        }
      }
    });
    return out;
  }

  function collectAllPossiblePaths(fields, prefix, paths){
    (fields || []).forEach(function(field){
      const label = field.label || "";
      const base = prefix ? prefix + "|" + label : label;

      if(field.type === "checkboxes" && Array.isArray(field.options)){
        field.options.forEach(function(option){
          const optionLabel = option.label || "";
          const key = base + "|" + optionLabel;
          paths.push(key);
          if(field.childrenByValue && field.childrenByValue[optionLabel]){
            collectAllPossiblePaths(field.childrenByValue[optionLabel], base + "|" + optionLabel, paths);
          }
        });
      } else if((field.type === "radio" || field.type === "select") && Array.isArray(field.options)){
        field.options.forEach(function(option){
          const optionLabel = option.label || "";
          const key = base + "|" + optionLabel;
          paths.push(key);
          if(field.childrenByValue && field.childrenByValue[optionLabel]){
            collectAllPossiblePaths(field.childrenByValue[optionLabel], base + "|" + optionLabel, paths);
          }
        });
      } else if(["text","textarea","number","regex","date","time"].includes(field.type)){
        paths.push(base);
      }
    });
    return paths;
  }

  function sortResponsesMap(map, schema, source){
    // If schema is provided, use schema order
    if(schema){
      const allPaths = collectAllPossiblePaths(schema, "", []);
      const sorted = {};
      allPaths.forEach(function(key){
        if(Object.prototype.hasOwnProperty.call(map, key)){
          sorted[key] = map[key];
        }
      });
      // Return all paths in the order array (not just those with values)
      return { map: sorted, keys: allPaths };
    }

    // Fallback to alphabetical order
    const keys = Object.keys(map || {}).sort(function(a, b){ return String(a).localeCompare(String(b)); });
    const sorted = {};
    keys.forEach(function(key){ sorted[key] = map[key]; });
    return { map: sorted, keys: keys };
  }

  function hasValidationErrors(fields){
    let bad = false;
    (function walk(arr){
      (arr || []).forEach(function(field){
        const value = responses[field.id];
        if(field.type === "regex"){
          const result = validateByPattern(field, value);
          if(!result.ok) bad = true;
        }
        if(field.childrenByValue) Object.keys(field.childrenByValue).forEach(function(key){ walk(field.childrenByValue[key]); });
      });
    })(fields);
    return bad;
  }

  function el(tag, attrs, children){
    const element = document.createElement(tag);
    (attrs ? Object.keys(attrs) : []).forEach(function(key){
      if(key === "class") element.className = attrs[key];
      else if(key === "text") element.textContent = attrs[key];
      else if(key.startsWith("on") && typeof attrs[key] === "function") element.addEventListener(key.slice(2), attrs[key]);
      else element.setAttribute(key, attrs[key]);
    });
    (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(function(child){ element.appendChild(child); });
    return element;
  }

  function renderFields(arr, depth){
    const frag = document.createDocumentFragment();
    (arr || []).forEach(function(field){ frag.appendChild(renderField(field, depth)); });
    return frag;
  }

  function renderField(field, depth){
    const wrap = el("div", { class: "field" });
    const label = el("label", { text: field.label || "項目" });
    if(field.required) label.appendChild(el("span", { text: " *" }));
    wrap.appendChild(label);

    const id = field.id;
    const value = responses[id];
    let inputEl = null;
    let errorEl = null;

    const makeChildContainer = function(){ return el("div", { class: "child" }); };

    if(field.type === "text"){
      inputEl = el("input", { type: "text" });
      inputEl.value = value || "";
      inputEl.addEventListener("input", function(event){ responses[id] = event.target.value; });
    } else if(field.type === "textarea"){
      inputEl = el("textarea");
      inputEl.value = value || "";
      inputEl.addEventListener("input", function(event){ responses[id] = event.target.value; });
    } else if(field.type === "number"){
      inputEl = el("input", { type: "number" });
      inputEl.value = value || "";
      inputEl.addEventListener("input", function(event){ responses[id] = event.target.value; });
    } else if(field.type === "regex"){
      inputEl = el("input", { type: "text" });
      inputEl.value = value || "";
      errorEl = el("div", { class: "error", text: "" });
      errorEl.style.display = "none";
      inputEl.addEventListener("input", function(event){
        responses[id] = event.target.value;
        const result = validateByPattern(field, event.target.value);
        if(!result.ok){
          errorEl.textContent = result.message;
          errorEl.style.display = "block";
          inputEl.style.borderColor = "#EF4444";
        } else {
          errorEl.textContent = "";
          errorEl.style.display = "none";
          inputEl.style.borderColor = "#CBD5E1";
        }
      });
    } else if(field.type === "radio"){
      inputEl = el("div");
      const childAll = makeChildContainer();
      (field.options || []).forEach(function(opt){
        const line = el("label", {});
        const radio = el("input", { type: "radio", name: id });
        if(value === opt.label) radio.checked = true;
        radio.addEventListener("change", function(){
          responses[id] = opt.label;
          childAll.innerHTML = "";
          if(field.childrenByValue && field.childrenByValue[opt.label]){
            childAll.appendChild(renderFields(field.childrenByValue[opt.label], depth + 1));
          }
        });
        line.appendChild(radio);
        line.appendChild(el("span", { text: " " + (opt.label || "選択肢") }));
        inputEl.appendChild(line);
        inputEl.appendChild(el("br"));
      });
      if(field.childrenByValue && value && field.childrenByValue[value]){
        childAll.appendChild(renderFields(field.childrenByValue[value], depth + 1));
      }
      inputEl.appendChild(childAll);
    } else if(field.type === "select"){
      const select = el("select");
      select.appendChild(el("option", { value: "", text: "-- 未選択 --" }));
      (field.options || []).forEach(function(opt){
        select.appendChild(el("option", { value: opt.label, text: opt.label || "選択肢" }));
      });
      select.value = value || "";
      const childAll = makeChildContainer();
      select.addEventListener("change", function(event){
        const selected = event.target.value;
        responses[id] = selected;
        childAll.innerHTML = "";
        if(field.childrenByValue && field.childrenByValue[selected]){
          childAll.appendChild(renderFields(field.childrenByValue[selected], depth + 1));
        }
      });
      inputEl = el("div", {}, [select, childAll]);
      if(value && field.childrenByValue && field.childrenByValue[value]){
        childAll.appendChild(renderFields(field.childrenByValue[value], depth + 1));
      }
    } else if(field.type === "checkboxes"){
      const container = el("div");
      const arr = Array.isArray(value) ? value : [];
      (field.options || []).forEach(function(opt){
        const line = el("label", {});
        const checkbox = el("input", { type: "checkbox" });
        if(arr.includes(opt.label)) checkbox.checked = true;
        const child = makeChildContainer();
        checkbox.addEventListener("change", function(event){
          const set = new Set(Array.isArray(responses[id]) ? responses[id] : []);
          event.target.checked ? set.add(opt.label) : set.delete(opt.label);
          responses[id] = Array.from(set);
          child.innerHTML = "";
          if(event.target.checked && field.childrenByValue && field.childrenByValue[opt.label]){
            child.appendChild(renderFields(field.childrenByValue[opt.label], depth + 1));
          }
        });
        line.appendChild(checkbox);
        line.appendChild(el("span", { text: " " + (opt.label || "選択肢") }));
        container.appendChild(line);
        container.appendChild(el("br"));
        if(arr.includes(opt.label) && field.childrenByValue && field.childrenByValue[opt.label]){
          child.appendChild(renderFields(field.childrenByValue[opt.label], depth + 1));
        }
        container.appendChild(child);
      });
      inputEl = container;
    } else if(field.type === "date"){
      inputEl = el("input", { type: "date" });
      const useValue = value === undefined || value === null ? responses[id] : value;
      const initial = useValue === undefined || useValue === null ? "" : useValue;
      const isNewRecord = !CFG.recordId || CFG.recordId === recordId;
      if(isNewRecord && initial === "" && field.defaultNow){
        const now = formatDateLocal(new Date());
        responses[id] = now;
        inputEl.value = now;
      } else {
        inputEl.value = initial;
      }
      inputEl.addEventListener("input", function(event){ responses[id] = event.target.value; });
    } else if(field.type === "time"){
      inputEl = el("input", { type: "time" });
      const useValue = value === undefined || value === null ? responses[id] : value;
      const initial = useValue === undefined || useValue === null ? "" : useValue;
      const isNewRecord = !CFG.recordId || CFG.recordId === recordId;
      if(isNewRecord && initial === "" && field.defaultNow){
        const now = formatTimeLocal(new Date());
        responses[id] = now;
        inputEl.value = now;
      } else {
        inputEl.value = initial;
      }
      inputEl.addEventListener("input", function(event){ responses[id] = event.target.value; });
    }

    wrap.appendChild(inputEl);
    if(errorEl) wrap.appendChild(errorEl);
    return wrap;
  }

  function renderRoot(){
    const root = document.getElementById("app");
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(renderFields(schema, 0));
  }

  renderRoot();

  const saveBtn = document.getElementById("saveBtn");
  if(!saveBtn) return;

  saveBtn.addEventListener("click", async function(){
    const hasScriptRun = typeof google !== "undefined" && google.script && google.script.run;

    if(!hasScriptRun && CFG.gasUrl === ""){
      showCustomAlert("GAS WebApp URL が設定されていません");
      return;
    }
    if(CFG.spreadsheetId === ""){
      showCustomAlert("Spreadsheet ID が設定されていません");
      return;
    }
    if(hasValidationErrors(schema)){
      showCustomAlert("正規表現のエラー、必須空、またはパターン不一致の回答があります。修正してください。");
      return;
    }

    if(saveBtn.dataset.loading === "true") return;
    const originalLabel = saveBtn.textContent;
    saveBtn.dataset.loading = "true";
    saveBtn.textContent = "送信中...";
    saveBtn.disabled = true;

    try {
      const payloadResponses = collectResponses(schema, responses, "", {}, null);

      const sorted = sortResponsesMap(payloadResponses, schema, responses);

      const payload = {
        version: CFG.version || 1,
        formTitle: CFG.formTitle || document.title,
        schemaHash: CFG.schemaHash || "",
        id: recordId,
        responses: sorted.map,
        order: sorted.keys,
        spreadsheetId: CFG.spreadsheetId,
        sheetName: CFG.sheetName || "Responses",
      };

      const submitViaScriptRun = function(){
        return new Promise(function(resolve, reject){
          google.script.run
            .withSuccessHandler(function(result){
              resolve(result);
            })
            .withFailureHandler(function(error){
              console.error("[NFB] google.script.run FAILURE:", error);
              if(error instanceof Error){ reject(error); return; }
              if(error && typeof error.message === "string"){ reject(new Error(error.message)); return; }
              try {
                reject(new Error(JSON.stringify(error) || "Apps Script call failed"));
              } catch(e){
                reject(new Error("Apps Script call failed"));
              }
            })
            .saveResponses(payload);
        });
      };

      const submitViaFetch = async function(){
        const res = await fetch(CFG.gasUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
          mode: "cors",
        });
        const json = await res.json().catch(function(){ return {}; });
        if(!res.ok || json.ok === false){
          const message = json.error || (res.status + " " + res.statusText);
          throw new Error(message);
        }
        return json;
      };

      const json = hasScriptRun ? await submitViaScriptRun() : await submitViaFetch();

      if(!json || json.ok === false){
        const message = json && json.error ? json.error : "送信に失敗しました";
        console.error("[NFB] Submit failed with message:", message);
        throw new Error(message);
      }

      showCustomAlert("送信しました");
    } catch (err) {
      console.error("[NFB] submit error", err);
      console.error("[NFB] error message:", err.message);
      console.error("[NFB] error stack:", err.stack);
      showCustomAlert("送信に失敗しました: " + (err && err.message ? err.message : String(err)));
    } finally {
      saveBtn.dataset.loading = "false";
      saveBtn.textContent = originalLabel;
      saveBtn.disabled = false;
    }
  });
})();`;

  return script.replace(/<\/script/gi, "<\\/script");
};
