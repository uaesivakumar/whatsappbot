(function () {
  const qs = (s) => document.querySelector(s);
  const baseUrl = window.__ADMIN_CONSOLE__?.baseUrl || window.location.origin;

  const els = {
    backendUrl: qs("#backend-url"),
    diagBadge: qs("#diag-badge"),
    loginCard: qs("#loginCard"),
    appWrap: qs("#appWrap"),
    username: qs("#username"),
    password: qs("#password"),
    loginBtn: qs("#loginBtn"),
    logoutBtn: qs("#logoutBtn"),
    loginStatus: qs("#loginStatus"),

    // Tabs
    tabBtns: document.querySelectorAll(".tabbtn"),
    tabs: document.querySelectorAll(".tab"),

    // KB actions
    search: qs("#search"),
    refreshCount: qs("#refreshCount"),
    refreshList: qs("#refreshList"),
    kbCount: qs("#kbCount"),
    limit: qs("#limit"),
    offset: qs("#offset"),
    applyPage: qs("#applyPage"),

    // KB add
    content: qs("#content"),
    metaSrc: qs("#metaSrc"),
    metaProduct: qs("#metaProduct"),
    metaTags: qs("#metaTags"),
    addChunk: qs("#addChunk"),
    addStatus: qs("#addStatus"),
    embedMissing: qs("#embedMissing"),

    // KB list
    kbTableBody: qs("#kbTableBody"),
    listStatus: qs("#listStatus"),

    // Semantic (KB QA)
    qSemantic: qs("#qSemantic"),
    doSemantic: qs("#doSemantic"),
    semanticStatus: qs("#semanticStatus"),
    semanticResults: qs("#semanticResults"),

    // Bot preview
    botQ: qs("#botQ"),
    botPhone: qs("#botPhone"),
    botName: qs("#botName"),
    botGenerate: qs("#botGenerate"),
    botAsk: qs("#botAsk"),
    botStatus: qs("#botStatus"),
    botIntent: qs("#botIntent"),
    botAnswer: qs("#botAnswer"),
    botContexts: qs("#botContexts"),

    // Messages
    msgTableBody: qs("#msgTableBody"),
    msgStatus: qs("#msgStatus"),

    // Customers
    cPhone: qs("#cPhone"),
    cName: qs("#cName"),
    cCompany: qs("#cCompany"),
    cSalary: qs("#cSalary"),
    cNotes: qs("#cNotes"),
    saveCustomer: qs("#saveCustomer"),
    custStatus: qs("#custStatus"),
    custTableBody: qs("#custTableBody"),
    custListStatus: qs("#custListStatus"),
  };
  els.backendUrl.textContent = baseUrl;

  // -------- utilities
  const handleResp = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const setBadge = (ok) => {
    if (ok) {
      els.diagBadge.textContent = "DB OK";
      els.diagBadge.className = "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-green-100 text-green-800 border border-green-200";
    } else {
      els.diagBadge.textContent = "DB Error";
      els.diagBadge.className = "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-red-100 text-red-800 border border-red-200";
    }
  };
  const setAuthedUI = (on) => {
    if (on) { els.appWrap.classList.remove("hidden"); els.logoutBtn.classList.remove("hidden"); els.loginStatus.textContent = "Signed in ✓"; }
    else { els.appWrap.classList.add("hidden"); els.logoutBtn.classList.add("hidden"); els.loginStatus.textContent = ""; }
  };

  // -------- tabs
  els.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.tabBtns.forEach((b) => b.classList.replace("bg-indigo-600", "bg-gray-200"));
      els.tabBtns.forEach((b) => b.classList.replace("text-white", "text-gray-900"));
      btn.classList.replace("bg-gray-200", "bg-indigo-600");
      btn.classList.replace("text-gray-900", "text-white");
      const id = btn.getAttribute("data-tab");
      els.tabs.forEach((t) => t.classList.add("hidden"));
      qs(`#${id}`).classList.remove("hidden");
      if (id === "tab-msg") loadMessages();
      if (id === "tab-cust") loadCustomers();
    });
  });

  // -------- health/auth
  const checkDiag = async () => {
    try {
      const r = await fetch(`${baseUrl}/__diag`, { credentials: "include" });
      const d = await handleResp(r);
      setBadge(Boolean(r.ok && d?.ok && d?.db_ok));
    } catch { setBadge(false); }
  };
  const checkAuthed = async () => {
    try {
      const r = await fetch(`${baseUrl}/admin/me`, { credentials: "include" });
      if (!r.ok) { setAuthedUI(false); return false; }
      const d = await handleResp(r);
      const ok = Boolean(d?.authed);
      setAuthedUI(ok);
      if (ok) { await refreshCount(); await refreshList(); }
      return ok;
    } catch { setAuthedUI(false); return false; }
  };

  // -------- KB actions
  const buildQS = () => {
    const p = new URLSearchParams();
    p.set("limit", String(Math.max(1, Math.min(200, parseInt(els.limit.value || "10", 10)))));
    p.set("offset", String(Math.max(0, parseInt(els.offset.value || "0", 10))));
    const s = (els.search.value || "").trim(); if (s) p.set("search", s);
    return p.toString();
  };

  const refreshCount = async () => {
    els.kbCount.textContent = "…";
    try {
      const r = await fetch(`${baseUrl}/admin/kb/count?${buildQS()}`, { credentials: "include" });
      const d = await handleResp(r);
      els.kbCount.textContent = r.ok ? (d?.count ?? "—") : "error";
    } catch { els.kbCount.textContent = "error"; }
  };

  const renderRows = (rows) => {
    els.kbTableBody.innerHTML = "";
    if (!rows?.length) {
      els.kbTableBody.innerHTML = `<tr><td colspan="5" class="py-3 text-gray-500">No rows.</td></tr>`;
      return;
    }
    const toStr = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.className = "border-b align-top";
      const id = toStr(row.id);
      const full = toStr(row.content || "");
      const excerpt = full.slice(0, 120);
      const meta = toStr(row.meta);
      const upd = row.updated_at ? new Date(row.updated_at).toLocaleString() : "";
      tr.innerHTML = `
        <td class="py-2 pr-4 font-mono text-xs break-all">${id}</td>
        <td class="py-2 pr-4"><div class="text-sm">${excerpt}${full.length>120?"…":""}</div></td>
        <td class="py-2 pr-4 font-mono text-xs break-all">${meta}</td>
        <td class="py-2 pr-4 text-xs text-gray-600">${upd}</td>
        <td class="py-2 pr-4">
          <div class="flex gap-2">
            <button class="editBtn rounded-lg bg-amber-100 hover:bg-amber-200 px-2 py-1 text-xs" data-id="${id}">Edit</button>
            <button class="deleteBtn rounded-lg bg-rose-100 hover:bg-rose-200 px-2 py-1 text-xs" data-id="${id}">Delete</button>
            <button class="embedBtn rounded-lg bg-indigo-100 hover:bg-indigo-200 px-2 py-1 text-xs" data-id="${id}">Embed</button>
          </div>
        </td>`;
      els.kbTableBody.appendChild(tr);
    }
    els.kbTableBody.querySelectorAll(".deleteBtn").forEach((b)=>b.addEventListener("click",()=>doDelete(b.dataset.id)));
    els.kbTableBody.querySelectorAll(".editBtn").forEach((b)=>b.addEventListener("click",()=>openEdit(b.dataset.id)));
    els.kbTableBody.querySelectorAll(".embedBtn").forEach((b)=>b.addEventListener("click",()=>doEmbedOne(b.dataset.id)));
  };

  const refreshList = async () => {
    els.listStatus.textContent = "Loading…";
    try {
      const r = await fetch(`${baseUrl}/admin/kb/list?${buildQS()}`, { credentials: "include" });
      const d = await handleResp(r);
      const rows = Array.isArray(d) ? d : d?.rows || [];
      renderRows(rows);
      els.listStatus.textContent = `Loaded ${rows.length} row(s).`;
    } catch (e) { els.listStatus.textContent = `List exception: ${e.message}`; }
  };

  const getTags = () => {
    const arr = [];
    for (const o of els.metaTags.options) if (o.selected) arr.push(o.value);
    return arr;
  };

  const addChunk = async () => {
    els.addStatus.textContent = "Adding…";
    const content = (els.content.value || "").trim();
    if (!content) { els.addStatus.textContent = "Content required."; return; }
    const meta = { src: els.metaSrc.value || "intranet", product: (els.metaProduct.value || "").trim() || undefined, tags: getTags() };
    try {
      const r = await fetch(`${baseUrl}/admin/kb`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, meta })
      });
      const d = await handleResp(r);
      if (!r.ok) { els.addStatus.textContent = `Add error: ${JSON.stringify(d)}`; return; }
      els.addStatus.textContent = "Added ✓";
      els.content.value = ""; els.metaProduct.value = ""; [...els.metaTags.options].forEach(o=>o.selected=false);
      await refreshCount(); await refreshList();
    } catch (e) { els.addStatus.textContent = `Add exception: ${e.message}`; }
  };

  const openEdit = async (id) => {
    const rowEl = [...els.kbTableBody.querySelectorAll("tr")].find(tr => tr.querySelector(`button.editBtn[data-id="${id}"]`));
    if (!rowEl) return;
    const cells = rowEl.querySelectorAll("td");
    const contentCell = cells[1], metaCell = cells[2], actionsCell = cells[4];
    const currentContent = contentCell.textContent.trim();
    const currentMetaText = metaCell.textContent.trim() || "{}";
    contentCell.innerHTML = `<textarea class="w-full rounded-lg border px-2 py-1 text-sm" rows="4">${currentContent}</textarea>`;
    metaCell.innerHTML = `<textarea class="w-full rounded-lg border px-2 py-1 text-xs font-mono" rows="4">${currentMetaText}</textarea>`;
    actionsCell.innerHTML = `<div class="flex gap-2"><button class="saveBtn rounded-lg bg-green-100 px-2 py-1 text-xs">Save</button><button class="cancelBtn rounded-lg bg-gray-100 px-2 py-1 text-xs">Cancel</button></div>`;
    actionsCell.querySelector(".saveBtn").addEventListener("click", async () => {
      const newContent = contentCell.querySelector("textarea").value.trim();
      let newMeta; try { newMeta = JSON.parse(metaCell.querySelector("textarea").value.trim() || "{}"); }
      catch (e) { alert(`Meta JSON error: ${e.message}`); return; }
      const r = await fetch(`${baseUrl}/admin/kb/${id}`, { method:"PUT", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ content:newContent, meta:newMeta }) });
      const d = await handleResp(r);
      if (!r.ok) { alert(`Update failed: ${JSON.stringify(d)}`); return; }
      await refreshList();
    });
    actionsCell.querySelector(".cancelBtn").addEventListener("click", refreshList);
  };

  const doDelete = async (id) => {
    if (!confirm("Delete this chunk?")) return;
    const r = await fetch(`${baseUrl}/admin/kb/${id}`, { method:"DELETE", credentials:"include" });
    const d = await handleResp(r);
    if (!r.ok) alert(`Delete failed: ${JSON.stringify(d)}`); else { await refreshCount(); await refreshList(); }
  };

  const doEmbedOne = async (id) => {
    const r = await fetch(`${baseUrl}/admin/kb/embed/${id}`, { method:"POST", credentials:"include" });
    const d = await handleResp(r);
    if (!r.ok) alert(`Embed failed: ${JSON.stringify(d)}`); else els.listStatus.textContent = `Embedded ${id}`;
  };

  const doEmbedMissing = async () => {
    els.addStatus.textContent = "Embedding missing…";
    const r = await fetch(`${baseUrl}/admin/kb/embed/missing?limit=10`, { method:"POST", credentials:"include" });
    const d = await handleResp(r);
    els.addStatus.textContent = r.ok ? `Embedded ${d.updated_count} item(s).` : `Error: ${JSON.stringify(d)}`;
    await refreshList();
  };

  // -------- Semantic QA (KB)
  const doSemantic = async () => {
    const q = (els.qSemantic.value || "").trim();
    if (!q) { els.semanticStatus.textContent = "Enter a query."; return; }
    els.semanticStatus.textContent = "Searching…"; els.semanticResults.innerHTML = "";
    const r = await fetch(`${baseUrl}/admin/kb/search`, { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ query:q, k:6 }) });
    const d = await handleResp(r);
    if (!r.ok) { els.semanticStatus.textContent = `Error: ${JSON.stringify(d)}`; return; }
    const rows = d?.results || [];
    els.semanticResults.innerHTML = rows.map(row => `
      <div class="rounded-xl border p-4">
        <div class="text-xs text-gray-500 mb-1">id: <span class="font-mono">${row.id}</span> · distance: ${Number(row.distance).toFixed(4)}</div>
        <div class="text-lg font-semibold mb-1">${(row.content || "").slice(0, 120)}${(row.content || "").length > 120 ? "…" : ""}</div>
        <div class="text-sm">${(row.content || "").slice(0, 700)}${(row.content || "").length > 700 ? "…" : ""}</div>
      </div>`).join("");
    els.semanticStatus.textContent = `Found ${rows.length} result(s).`;
  };

  // -------- Bot Preview (RAG)
  const botAsk = async () => {
    const text = (els.botQ.value || "").trim();
    if (!text) { els.botStatus.textContent = "Enter a user question."; return; }
    els.botStatus.textContent = "Thinking…"; els.botAnswer.textContent = ""; els.botContexts.innerHTML = ""; els.botIntent.textContent = "";
    const body = {
      text,
      k: 3,
      generate: Boolean(els.botGenerate.checked),
      customer: { phone: (els.botPhone.value || "").trim(), name: (els.botName.value || "").trim() || undefined }
    };
    const r = await fetch(`${baseUrl}/rag/query`, { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const d = await handleResp(r);
    if (!r.ok) { els.botStatus.textContent = `Error: ${JSON.stringify(d)}`; return; }
    els.botStatus.textContent = `Saved message: ${d.message_id}`;
    els.botIntent.innerHTML = `<span class="text-sm">Intent: <b>${d.intent}</b> · Confidence: <b>${d.intent_confidence_pct}%</b></span>`;
    els.botAnswer.textContent = d.answer || "(No answer generated — uncheck 'Generate answer'?)";
    els.botContexts.innerHTML = (d.contexts || []).map((c,i)=>`
      <div class="rounded-xl border p-3">
        <div class="text-xs text-gray-500 mb-1">#${i+1} id:${c.id} · distance:${Number(c.distance).toFixed(4)}</div>
        <div>${(c.content||"").slice(0,700)}${(c.content||"").length>700?"…":""}</div>
      </div>`).join("");
  };

  // -------- Messages list
  const loadMessages = async () => {
    els.msgStatus.textContent = "Loading…"; els.msgTableBody.innerHTML = "";
    const r = await fetch(`${baseUrl}/admin/messages?limit=50`, { credentials:"include" });
    const d = await handleResp(r);
    if (!r.ok) { els.msgStatus.textContent = `Error: ${JSON.stringify(d)}`; return; }
    const rows = d?.rows || [];
    els.msgTableBody.innerHTML = rows.map(row => `
      <tr class="border-b">
        <td class="py-2 pr-4 text-xs text-gray-600">${new Date(row.created_at).toLocaleString()}</td>
        <td class="py-2 pr-4">${row.phone||"-"} ${row.name?("· "+row.name):""}</td>
        <td class="py-2 pr-4">${row.intent||"-"} (${row.intent_score||0}%)</td>
        <td class="py-2 pr-4">${(row.text_preview||"").replace(/\n/g," ")}</td>
        <td class="py-2 pr-4"><a class="text-indigo-600 underline" href="${baseUrl}/admin/messages/${row.id}" target="_blank">Open JSON</a></td>
      </tr>`).join("");
    els.msgStatus.textContent = `Loaded ${rows.length} message(s).`;
  };

  // -------- Customers
  const loadCustomers = async () => {
    els.custListStatus.textContent = "Loading…"; els.custTableBody.innerHTML = "";
    const r = await fetch(`${baseUrl}/admin/customers?limit=100`, { credentials:"include" });
    const d = await handleResp(r);
    const rows = d?.rows || [];
    els.custTableBody.innerHTML = rows.map(row => `
      <tr class="border-b">
        <td class="py-2 pr-4">${row.phone||"-"}</td>
        <td class="py-2 pr-4">${row.name||"-"}</td>
        <td class="py-2 pr-4">${row.company||"-"}</td>
        <td class="py-2 pr-4">${row.salary||"-"}</td>
        <td class="py-2 pr-4 text-xs text-gray-600">${new Date(row.updated_at).toLocaleString()}</td>
      </tr>`).join("");
    els.custListStatus.textContent = `Loaded ${rows.length} customer(s).`;
  };

  const saveCustomer = async () => {
    els.custStatus.textContent = "Saving…";
    const body = {
      phone: (els.cPhone.value||"").trim(),
      name: (els.cName.value||"").trim() || null,
      company: (els.cCompany.value||"").trim() || null,
      salary: (els.cSalary.value||"").trim() || null,
      notes: (els.cNotes.value||"").trim() || null,
      meta: {}
    };
    if (!body.phone) { els.custStatus.textContent = "Phone is required."; return; }
    const r = await fetch(`${baseUrl}/admin/customers`, { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const d = await handleResp(r);
    els.custStatus.textContent = r.ok ? "Saved ✓" : `Error: ${JSON.stringify(d)}`;
    if (r.ok) loadCustomers();
  };

  // -------- auth events
  els.loginBtn.addEventListener("click", async () => {
    els.loginStatus.textContent = "Signing in…";
    const r = await fetch(`${baseUrl}/admin/login`, { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ username: els.username.value.trim(), password: els.password.value.trim() }) });
    const d = await handleResp(r);
    if (!r.ok) { els.loginStatus.textContent = `Login failed: ${JSON.stringify(d)}`; setAuthedUI(false); return; }
    els.loginStatus.textContent = "Signed in ✓"; setAuthedUI(true); await refreshCount(); await refreshList();
  });
  els.logoutBtn.addEventListener("click", async () => {
    els.loginStatus.textContent = "Signing out…";
    try { await fetch(`${baseUrl}/admin/logout`, { method:"POST", credentials:"include" }); } catch {}
    setAuthedUI(false); els.loginStatus.textContent = "Signed out.";
  });

  // -------- UI events
  els.refreshCount.addEventListener("click", refreshCount);
  els.refreshList.addEventListener("click", refreshList);
  els.applyPage.addEventListener("click", refreshList);
  els.search.addEventListener("keydown", (e)=>{ if (e.key==="Enter") { els.offset.value="0"; refreshCount(); refreshList(); }});
  els.addChunk.addEventListener("click", addChunk);
  els.embedMissing.addEventListener("click", doEmbedMissing);
  els.doSemantic.addEventListener("click", doSemantic);
  els.qSemantic.addEventListener("keydown", (e)=>{ if (e.key==="Enter") doSemantic(); });
  els.botAsk.addEventListener("click", botAsk);
  els.saveCustomer.addEventListener("click", saveCustomer);

  // -------- init
  (async () => {
    await checkDiag();
    await checkAuthed();
  })();
})();
