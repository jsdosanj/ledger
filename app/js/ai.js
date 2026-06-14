/* ============================================================
   Ledger — BYO-key AI (CLIENT-DIRECT ONLY).

   The user supplies their OWN provider key (OpenAI / Anthropic / OpenRouter).
   The key lives in localStorage and the BROWSER calls the provider's API
   DIRECTLY — never through Keystone, never through any DosanjhLabs server. We
   never pay for inference and never see the key.

   Features (all over the user's own docs, which are just markdown):
     1. Draft a doc — bullet notes + doc type -> a runbook/asset page.
     2. Summarize — TL;DR of the active page.
     3. Ask your docs — retrieval over the local index, answer with citations.

   SECRET SAFETY: Ledger stores no secrets, but users could still paste one. A
   pre-send scrubber redacts obvious secret/PII patterns and (for the free-text
   "draft" path) hard-blocks if a likely secret is present, reinforcing the
   no-secrets posture. AI output is advisory; the user reviews before it lands.

   Plain global (window.LedgerAI) — NOT an ES module, NOT wired to the cloud
   SDK — so it works in the 100% local-first free tier with no account.
   ============================================================ */
(function () {
  "use strict";

  var LS_KEY = "ledger_ai_settings_v1"; // { provider, key, model }

  var PROVIDERS = {
    openrouter: {
      label: "OpenRouter (recommended)",
      defaultModel: "anthropic/claude-3.5-sonnet",
      keyHint: "sk-or-…  ·  get one at openrouter.ai/keys",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      build: function (key, model, system, user) {
        return {
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + key,
            "HTTP-Referer": location.origin || "https://dosanjhlabs.com/ledger",
            "X-Title": "Ledger IT Docs",
          },
          body: { model: model, max_tokens: 900, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
        };
      },
      parse: function (j) { return j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; },
    },
    openai: {
      label: "OpenAI",
      defaultModel: "gpt-4o-mini",
      keyHint: "sk-…  ·  platform.openai.com/api-keys",
      endpoint: "https://api.openai.com/v1/chat/completions",
      build: function (key, model, system, user) {
        return {
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: { model: model, max_tokens: 900, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
        };
      },
      parse: function (j) { return j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; },
    },
    anthropic: {
      label: "Anthropic (Claude)",
      defaultModel: "claude-opus-4-8",
      keyHint: "sk-ant-…  ·  console.anthropic.com",
      endpoint: "https://api.anthropic.com/v1/messages",
      build: function (key, model, system, user) {
        return {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: { model: model, max_tokens: 900, system: system, messages: [{ role: "user", content: user }] },
        };
      },
      parse: function (j) {
        if (!j || !j.content) return null;
        return j.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("");
      },
    },
  };

  // --- settings --------------------------------------------------------------
  function getSettings() {
    try { var s = JSON.parse(localStorage.getItem(LS_KEY) || "null"); return s || { provider: "openrouter", key: "", model: "" }; }
    catch (e) { return { provider: "openrouter", key: "", model: "" }; }
  }
  function saveSettings(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSettings() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
  function configured() { var s = getSettings(); return !!(s.provider && s.key && PROVIDERS[s.provider]); }
  function modelFor(s) { return (s.model && s.model.trim()) || PROVIDERS[s.provider].defaultModel; }

  // --- secret/PII scrubber ---------------------------------------------------
  var SECRET_PATTERNS = [
    [/\bpassword\s*[:=]\s*\S+/gi, "password"],
    [/\bsecret\s*[:=]\s*\S+/gi, "secret"],
    [/\bapi[_-]?key\s*[:=]\s*\S+/gi, "api-key"],
    [/\bsk-[A-Za-z0-9]{16,}\b/g, "provider-key"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "private-key"],
    [/\b\d{3}-\d{2}-\d{4}\b/g, "ssn"],
    [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "email"],
  ];
  function scrub(text) {
    var reasons = {}; var out = String(text == null ? "" : text);
    SECRET_PATTERNS.forEach(function (p) { if (p[0].test(out)) { reasons[p[1]] = true; out = out.replace(p[0], "[redacted]"); } p[0].lastIndex = 0; });
    var keys = Object.keys(reasons);
    return { text: out, blocked: keys.length > 0, reasons: keys };
  }

  var SYSTEM_BASE =
    "You are an IT documentation assistant for an MSP / internal IT team using Ledger, a markdown-on-git knowledge base. " +
    "Write clean, practical markdown a technician can act on. Use clear headings, short steps, and tables where useful. " +
    "NEVER invent or include real passwords, API keys, or secrets — reference a password manager (vault link) instead. " +
    "Keep it tight. End drafted documents with no commentary, just the markdown.";

  // --- the one interface -----------------------------------------------------
  function chat(system, user, opts) {
    opts = opts || {};
    var s = getSettings();
    if (!configured()) return Promise.reject(new Error("No AI key set — add one in AI settings."));
    var prov = PROVIDERS[s.provider];

    var sc = scrub(user);
    if (sc.blocked && !opts.allowRedacted) {
      return Promise.reject(new Error("Blocked: the text may contain a secret or PII (" + sc.reasons.join(", ") + "). Remove it (use a vault link) and retry."));
    }
    var safeUser = sc.text;

    if (typeof opts.transport === "function") {
      return Promise.resolve(opts.transport({ provider: s.provider, endpoint: prov.endpoint, model: modelFor(s), system: system, user: safeUser, redacted: sc.blocked, req: prov.build(s.key, modelFor(s), system, safeUser) }));
    }
    var req = prov.build(s.key, modelFor(s), system, safeUser);
    return fetch(prov.endpoint, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) { var msg = (j && (j.error && (j.error.message || j.error) || j.message)) || ("HTTP " + r.status); throw new Error(String(msg)); }
        var out = prov.parse(j); if (!out) throw new Error("No text in provider response."); return out.trim();
      });
    });
  }

  // --- feature prompts -------------------------------------------------------
  function draftPrompt(docType, notes) {
    return "Draft a complete " + docType + " documentation page in markdown from these notes. " +
      "Include Obsidian-compatible YAML frontmatter (type, client, etc.) and clear sections. " +
      "Do NOT include any password/secret — reference a vault item instead.\n\nNotes:\n" + notes;
  }
  function summarizePrompt(title, body) {
    return "Summarize this IT documentation page into a 2-3 sentence TL;DR a busy technician can scan. Plain English.\n\nTitle: " + title + "\n\n---\n" + body;
  }
  function askPrompt(question, contexts) {
    var ctx = contexts.map(function (c) { return "### " + c.title + " (" + c.path + ")\n" + c.body; }).join("\n\n");
    return "Answer the question using ONLY the documentation excerpts below. Cite the page path(s) you used in parentheses. " +
      "If the docs don't contain the answer, say so.\n\nQuestion: " + question + "\n\n--- DOCS ---\n" + ctx;
  }

  // --- panel UI (rendered into app.js overlay) -------------------------------
  function renderPanel(el, bridge) {
    el.innerHTML = "";
    var s = getSettings();

    // settings block
    var set = div("card"); set.style.marginBottom = "1rem";
    set.innerHTML = '<h3 style="margin-top:0">Provider key (stored locally, browser calls the provider directly)</h3>';
    var prov = document.createElement("select");
    Object.keys(PROVIDERS).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = PROVIDERS[k].label; if (k === s.provider) o.selected = true; prov.appendChild(o); });
    var key = document.createElement("input"); key.type = "password"; key.placeholder = PROVIDERS[s.provider].keyHint; key.value = s.key || "";
    var model = document.createElement("input"); model.placeholder = "model (optional, default " + PROVIDERS[s.provider].defaultModel + ")"; model.value = s.model || "";
    [field("Provider", prov), field("API key", key), field("Model override", model)].forEach(function (f) { set.appendChild(f); });
    prov.onchange = function () { key.placeholder = PROVIDERS[prov.value].keyHint; model.placeholder = "model (optional, default " + PROVIDERS[prov.value].defaultModel + ")"; };
    var sb = div("row");
    sb.appendChild(button("Save key", "sm primary", function () { saveSettings({ provider: prov.value, key: key.value.trim(), model: model.value.trim() }); bridge.toast("AI key saved locally"); status(); }));
    sb.appendChild(button("Forget key", "sm ghost", function () { clearSettings(); key.value = ""; bridge.toast("Key forgotten"); status(); }));
    set.appendChild(sb);
    var st = div("muted small"); set.appendChild(st);
    function status() { st.textContent = configured() ? "✓ Configured — calls go directly to " + PROVIDERS[getSettings().provider].label + ", never to DosanjhLabs." : "Not configured. The free tier works without AI."; }
    status();
    el.appendChild(set);

    // feature: draft
    var draft = div("card"); draft.style.marginBottom = "1rem";
    draft.innerHTML = '<h3 style="margin-top:0">Draft a doc from notes</h3>';
    var dtype = document.createElement("select");
    ["runbook", "server asset page", "network note", "SOP / procedure", "onboarding checklist"].forEach(function (t) { var o = document.createElement("option"); o.textContent = t; dtype.appendChild(o); });
    var notes = document.createElement("textarea"); notes.placeholder = "Bullet notes… (no passwords — link a vault item instead)";
    draft.appendChild(field("Type", dtype)); draft.appendChild(field("Notes", notes));
    draft.appendChild(button("Draft it", "sm primary", function () {
      run(draftPrompt(dtype.value, notes.value), function (md) {
        var p = bridge.applyDraft(md, true, "AI " + dtype.value);
        bridge.toast("Draft created — review before keeping (tagged ai-drafted)");
      }, draft);
    }));
    el.appendChild(draft);

    // feature: summarize active doc
    var sum = div("card"); sum.style.marginBottom = "1rem";
    sum.innerHTML = '<h3 style="margin-top:0">Summarize the open page</h3>';
    var ctx = bridge.activeDocContext();
    if (!ctx) sum.innerHTML += '<p class="muted small">Open a document first.</p>';
    else sum.appendChild(button("Summarize \"" + ctx.title + "\"", "sm", function () {
      run(summarizePrompt(ctx.title, ctx.body), function (out) { showOut(sum, out); }, sum);
    }));
    el.appendChild(sum);

    // feature: ask your docs
    var ask = div("card");
    ask.innerHTML = '<h3 style="margin-top:0">Ask your docs</h3>';
    var qin = document.createElement("input"); qin.placeholder = "e.g. how do I restore internet after an outage?";
    ask.appendChild(field("Question", qin));
    ask.appendChild(button("Ask", "sm primary", function () {
      var contexts = bridge.retrieve(qin.value, 4);
      if (!contexts.length) { bridge.toast("No matching docs to answer from"); return; }
      run(askPrompt(qin.value, contexts), function (out) { showOut(ask, out + "\n\n— retrieved from: " + contexts.map(function (c) { return c.path; }).join(", ")); }, ask);
    }));
    el.appendChild(ask);

    function run(userPrompt, onText, host) {
      if (!configured()) { bridge.toast("Add an AI key first"); return; }
      var note = div("muted small"); note.textContent = "Calling " + PROVIDERS[getSettings().provider].label + "…"; host.appendChild(note);
      chat(SYSTEM_BASE, userPrompt).then(function (out) { note.remove(); onText(out); }).catch(function (e) { note.textContent = "Error: " + ((e && e.message) || e); });
    }
    function showOut(host, text) {
      var old = host.querySelector(".ai-out"); if (old) old.remove();
      var o = div("callout ai-out"); o.innerHTML = '<div class="muted small">AI-drafted — review before adopting</div>';
      var pre = document.createElement("div"); pre.style.cssText = "white-space:pre-wrap;font-size:.9rem;margin-top:.4rem"; pre.textContent = text;
      o.appendChild(pre); host.appendChild(o);
    }
  }

  function div(cls) { var d = document.createElement("div"); if (cls) d.className = cls; return d; }
  function field(label, input) { var f = div("field"); var l = document.createElement("label"); l.textContent = label; f.appendChild(l); f.appendChild(input); return f; }
  function button(label, cls, fn) { var b = document.createElement("button"); b.className = "btn " + (cls || ""); b.textContent = label; b.onclick = fn; return b; }

  window.LedgerAI = {
    PROVIDERS: PROVIDERS,
    getSettings: getSettings, saveSettings: saveSettings, clearSettings: clearSettings,
    configured: configured, modelFor: modelFor, scrub: scrub, chat: chat,
    draftPrompt: draftPrompt, summarizePrompt: summarizePrompt, askPrompt: askPrompt,
    SYSTEM_BASE: SYSTEM_BASE, renderPanel: renderPanel,
  };
})();
