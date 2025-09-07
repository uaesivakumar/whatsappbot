(function () {
  const qs = (s) => document.querySelector(s);

  const baseUrl = (window.__ADMIN_CONSOLE__ && window.__ADMIN_CONSOLE__.baseUrl) || window.location.origin;
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
    search: qs("#search"),
    refreshCount: qs("#refreshCount"),
    refreshList: qs("#refreshList"),
    kbCount: qs("#kbCount"),
    addChunk: qs("#addChunk"),
    addStatus: qs("#addStatus"),
    content: qs("#content"),
    meta: qs("#meta"),
    kbTableBody: qs("#kbTableBody"),
    listStatus: qs("#listStatus"),
    limit: qs("#limit"),
    offset: qs("#offset"),
    applyPage: qs("#applyPage"),
  };

  els.backendUrl.textContent = baseUrl;

  // --- helpers ---
  const handleResp = async (resp) => {
    const text = await resp.text();
    try { return JSON.parse(text); } catch { return text; }
  };

  const setBadge = (ok, msgIfOk = "DB OK", msgIfErr = "DB Error") => {
    if (!els.diagBadge) return;
    if (ok) {
      els.diagBadge.textContent = msgIfOk;
      els.diagBadge.className = "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-green-100 text-green-800 border border-green-200";
    } else {
      els.diagBadge.textContent = msgIfErr;
      els.diagBadge.className = "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-red-100 text-red-800 border border-red-200";
    }
  };

  const setAuthedUI = (isAuthed) => {
    if (isAuthed) {
      els.appWrap.classList.remove("hidden");
      els.logoutBtn.classList.remove("hidden");
      els.loginStatus.textContent = "Signed in ✓";
    } else {
      els.appWrap.classList.add("hidden");
      els.logoutBtn.classList.add("hidden");
      els.loginStatus.textContent = "";
    }
  };

  // --- diag (badge only) ---
  const checkDiag = async () => {
    try {
      const r = await fetch(`${baseUrl}/__diag`, { method: "GET", credentials: "include" });
      const data = await handleResp(r);
      const ok = r.ok && data && data.ok && data.db_ok;
      setBadge(Boolean(ok));
    } catch {
      setBadge(false);
    }
  };

  // --- auth status ---
  const checkAuthed = async () => {
    try {
      const r = await fetch(`${baseUrl}/admin/me`, { credentials: "include" });
      if (!r.ok) { setAuthedUI(false); return false; }
      const data = await handleResp(r);
      const authed = Boolean(data && data.authed);
      setAuthedUI(authed);
      return authed;
    } catch {
      setAuthedUI(false);
      return false;
    }
  };

  // --- count/list ---
  const buildQS = () => {
    const params = new URLSearchParams();
    const limit = Math.max(1, Math.min(200, parseInt(els.limit.value || "10", 10)));
    const offset = Math.max(0, parseInt(els.offset.value || "0", 10));
    const search = (els.search.value || "").trim();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (search) params.set("search", search);
    return params.toString();
  };

  const refreshCount = async () => {
    els.kbCount.textContent = "…";
    try {
      const qs = buildQS();
      const r = await fetch(`${baseUrl}/admin/kb/count?${qs}`, { method: "GET", credentials: "include" });
      if (!r.ok) {
        const err = await handleResp(r);
        els.kbCount.textContent = "error";
        els.listStatus.textContent = `Count error: ${JSON.stringify(err)}`;
        return;
      }
      const data = await handleResp(r);
      els.kbCount.textContent = (data && data.count != null) ? data.count : "—";
    } catch (e) {
      els.kbCount.textContent = "error";
      els.listStatus.textContent = `Count exception: ${e.message}`;
    }
  };

  const renderRows = (rows) => {
    els.kbTableBody.innerHTML = "";
    if (!Array.isArray(rows) || rows.length === 0) {
      els.kbTableBody.innerHTML = `<tr><td colspan="5" class="py-3 text-gray-500">No rows.</td></tr>`;
      return;
    }
    const toStr = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.className = "border-b align-top";
      const id = toStr(row.id);
      const fullContent = toStr(row.content || "");
      const excerpt = fullContent.slice(0, 120);
      const meta = toStr(row.meta);
      const upd = row.updated_at ? new Date(row.updated_at).toLocaleString() : "";
      tr.innerHTML = `
        <td class="py-2 pr-4 font-mono text-xs break-all">${id}</td>
        <td class="py-2 pr-4">
          <div class="text-sm">${excerpt}${fullContent.length > 120 ? "…" : ""}</div>
        </td>
        <td class="py-2 pr-4 font-mono text-xs break-all">${meta}</td>
        <td class="py-2 pr-4 text-xs text-gray-600">${upd}</td>
        <td class="py-2 pr-4">
          <div class="flex gap-2">
            <button class="editBtn rounded-lg bg-amber-100 hover:bg-amber-200 px-2 py-1 text-xs" data-id="${id}">Edit</button>
            <button class="deleteBtn rounded-lg bg-rose-100 hover:bg-rose-200 px-2 py-1 text-xs" data-id="${id}">Delete</button>
          </div>
        </td>
      `;
      els.kbTableBody.appendChild(tr);
    });

    // Wire buttons
    els.kbTableBody.querySelectorAll(".deleteBtn").forEach((btn) =>
      btn.addEventListener("click", () => doDelete(btn.dataset.id))
    );
    els.kbTableBody.querySelectorAll(".editBtn").forEach((btn) =>
      btn.addEventListener("click", () => openEdit(btn.dataset.id))
    );
  };

  const refreshList = async () => {
    els.listStatus.textContent = "Loading list…";
    try {
      const qs = buildQS();
      const r = await fetch(`${baseUrl}/admin/kb/list?${qs}`, { method: "GET", credentials: "include" });
      const data = await handleResp(r);
      if (!r.ok) {
        els.listStatus.textContent = `List error: ${JSON.stringify(data)}`;
        renderRows([]);
        return;
      }
      const rows = Array.isArray(data) ? data : (data && data.rows) ? data.rows : [];
      renderRows(rows);
      els.listStatus.textContent = `Loaded ${rows.length} row(s).`;
    } catch (e) {
      els.listStatus.textContent = `List exception: ${e.message}`;
      renderRows([]);
    }
  };

  // --- add ---
  const addChunk = async () => {
    els.addStatus.textContent = "Adding…";
    const content = (els.content.value || "").trim();
    if (!content) {
      els.addStatus.textContent = "Content is required.";
      return;
    }
    let meta = els.meta.value.trim();
    let metaObj = null;
    if (meta) {
      try { metaObj = JSON.parse(meta); }
      catch (e) { els.addStatus.textContent = `Meta must be valid JSON (${e.message}).`; return; }
    }
    const body = { content, meta: metaObj || { src: "admin-console" } };
    try {
      const r = await fetch(`${baseUrl}/admin/kb`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await handleResp(r);
      if (!r.ok) { els.addStatus.textContent = `Add error: ${JSON.stringify(data)}`; return; }
      els.addStatus.textContent = "Added ✓";
      els.content.value = "";
      await refreshCount();
      await refreshList();
    } catch (e) {
      els.addStatus.textContent = `Add exception: ${e.message}`;
    }
  };

  // --- edit/delete ---
  const openEdit = async (id) => {
    const rowEl = [...els.kbTableBody.querySelectorAll("tr")].find(tr =>
      tr.querySelector(`button.editBtn[data-id="${id}"]`)
    );
    if (!rowEl) return;

    const cells = rowEl.querySelectorAll("td");
    const contentCell = cells[1];
    const metaCell = cells[2];

    const currentContent = contentCell.textContent.trim();
    const currentMetaText = metaCell.textContent.trim();

    contentCell.innerHTML = `<textarea class="w-full rounded-lg border px-2 py-1 text-sm" rows="4">${currentContent}</textarea>`;
    metaCell.innerHTML = `<textarea class="w-full rounded-lg border px-2 py-1 text-xs font-mono" rows="4">${currentMetaText}</textarea>`;
    const actionsCell = cells[4];
    actionsCell.innerHTML = `
      <div class="flex gap-2">
        <button class="saveBtn rounded-lg bg-green-100 hover:bg-green-200 px-2 py-1 text-xs">Save</button>
        <button class="cancelBtn rounded-lg bg-gray-100 hover:bg-gray-200 px-2 py-1 text-xs">Cancel</button>
      </div>
    `;

    actionsCell.querySelector(".saveBtn").addEventListener("click", async () => {
      const newContent = contentCell.querySelector("textarea").value.trim();
      const newMetaText = metaCell.querySelector("textarea").value.trim() || "{}";
      let newMeta;
      try { newMeta = JSON.parse(newMetaText); }
      catch (e) { alert(`Meta must be valid JSON (${e.message}).`); return; }

      try {
        const r = await fetch(`${baseUrl}/admin/kb/${id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent, meta: newMeta })
        });
        const data = await handleResp(r);
        if (!r.ok) { alert(`Update failed: ${JSON.stringify(data)}`); return; }
        await refreshList();
      } catch (e) {
        alert(`Update exception: ${e.message}`);
      }
    });

    actionsCell.querySelector(".cancelBtn").addEventListener("click", refreshList);
  };

  const doDelete = async (id) => {
    if (!confirm("Delete this chunk?")) return;
    try {
      const r = await fetch(`${baseUrl}/admin/kb/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
      const data = await handleResp(r);
      if (!r.ok) { alert(`Delete failed: ${JSON.stringify(data)}`); return; }
      await refreshCount();
      await refreshList();
    } catch (e) {
      alert(`Delete exception: ${e.message}`);
    }
  };

  // --- login/logout ---
  const login = async () => {
    els.loginStatus.textContent = "Signing in…";
    try {
      const r = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: els.username.value.trim(),
          password: els.password.value.trim()
        })
      });
      const data = await handleResp(r);
      if (!r.ok) { els.loginStatus.textContent = `Login failed: ${JSON.stringify(data)}`; setAuthedUI(false); return; }
      els.loginStatus.textContent = "Signed in ✓";
      setAuthedUI(true);
      await refreshCount();
      await refreshList();
    } catch (e) {
      els.loginStatus.textContent = `Login exception: ${e.message}`;
      setAuthedUI(false);
    }
  };

  const logout = async () => {
    els.loginStatus.textContent = "Signing out…";
    try { await fetch(`${baseUrl}/admin/logout`, { method: "POST", credentials: "include" }); } catch {}
    setAuthedUI(false);
    els.loginStatus.textContent = "Signed out.";
    els.kbCount.textContent = "—";
    els.kbTableBody.innerHTML = "";
    els.listStatus.textContent = "";
  };

  // --- events ---
  els.loginBtn.addEventListener("click", login);
  els.logoutBtn.addEventListener("click", logout);
  els.refreshCount.addEventListener("click", () => { refreshCount(); });
  els.refreshList.addEventListener("click", () => { refreshList(); });
  els.applyPage.addEventListener("click", () => { refreshList(); });
  els.search.addEventListener("keydown", (e) => { if (e.key === "Enter") { els.offset.value = "0"; refreshCount(); refreshList(); }});
  els.addChunk.addEventListener("click", addChunk);

  // --- init ---
  (async () => {
    await checkDiag();
    const authed = await checkAuthed();
    if (authed) {
      await refreshCount();
      await refreshList();
    }
  })();
})();
