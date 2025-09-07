(function () {
  const qs = (s) => document.querySelector(s);

  const baseUrl = (window.__ADMIN_CONSOLE__ && window.__ADMIN_CONSOLE__.baseUrl) || window.location.origin;
  const els = {
    backendUrl: qs("#backend-url"),
    diag: qs("#diag"),
    loginCard: qs("#loginCard"),
    appWrap: qs("#appWrap"),
    username: qs("#username"),
    password: qs("#password"),
    loginBtn: qs("#loginBtn"),
    logoutBtn: qs("#logoutBtn"),
    loginStatus: qs("#loginStatus"),
    refreshDiag: qs("#refreshDiag"),
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
    applyLimit: qs("#applyLimit"),
  };

  els.backendUrl.textContent = baseUrl;

  // --- helpers ---
  const handleResp = async (resp) => {
    const text = await resp.text();
    try { return JSON.parse(text); } catch { return text; }
  };

  const setAuthedUI = (isAuthed) => {
    if (isAuthed) {
      els.appWrap.classList.remove("hidden");
      els.logoutBtn.classList.remove("hidden");
    } else {
      els.appWrap.classList.add("hidden");
      els.logoutBtn.classList.add("hidden");
    }
  };

  // Simple ping to know if cookie/session is already valid
  const checkAuthed = async () => {
    try {
      const r = await fetch(`${baseUrl}/admin/kb/count`, { method: "GET", credentials: "include" });
      setAuthedUI(r.ok);
      return r.ok;
    } catch {
      setAuthedUI(false);
      return false;
    }
  };

  // --- diag ---
  const checkDiag = async () => {
    els.diag.textContent = "Checking __diag…";
    try {
      const r = await fetch(`${baseUrl}/__diag`, { method: "GET", credentials: "include" });
      const data = await handleResp(r);
      els.diag.textContent = typeof data === "string" ? data : JSON.stringify(data);
    } catch (e) {
      els.diag.textContent = `__diag error: ${e.message}`;
    }
  };

  // --- count/list ---
  const refreshCount = async () => {
    els.kbCount.textContent = "…";
    try {
      const r = await fetch(`${baseUrl}/admin/kb/count`, { method: "GET", credentials: "include" });
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
      els.kbTableBody.innerHTML = `<tr><td colspan="4" class="py-3 text-gray-500">No rows.</td></tr>`;
      return;
    }
    const toStr = (v) => {
      if (v == null) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    };
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.className = "border-b align-top";
      const id = toStr(row.id);
      const excerpt = toStr(row.content || "").slice(0, 120);
      const meta = toStr(row.meta);
      const upd = row.updated_at ? new Date(row.updated_at).toLocaleString() : "";
      tr.innerHTML = `
        <td class="py-2 pr-4 font-mono text-xs break-all">${id}</td>
        <td class="py-2 pr-4">${excerpt}${(row.content || "").length > 120 ? "…" : ""}</td>
        <td class="py-2 pr-4 font-mono text-xs break-all">${meta}</td>
        <td class="py-2 pr-4 text-xs text-gray-600">${upd}</td>
      `;
      els.kbTableBody.appendChild(tr);
    });
  };

  const refreshList = async () => {
    els.listStatus.textContent = "Loading list…";
    const limit = Math.max(1, Math.min(200, parseInt(els.limit.value || "10", 10)));
    try {
      const r = await fetch(`${baseUrl}/admin/kb/list?limit=${limit}`, { method: "GET", credentials: "include" });
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
      catch (e) {
        els.addStatus.textContent = `Meta must be valid JSON (${e.message}).`;
        return;
      }
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
      if (!r.ok) {
        els.addStatus.textContent = `Add error: ${JSON.stringify(data)}`;
        return;
      }
      els.addStatus.textContent = "Added ✓";
      els.content.value = "";
      await refreshCount();
      await refreshList();
    } catch (e) {
      els.addStatus.textContent = `Add exception: ${e.message}`;
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
      if (!r.ok) {
        els.loginStatus.textContent = `Login failed: ${JSON.stringify(data)}`;
        setAuthedUI(false);
        return;
      }
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
    try {
      await fetch(`${baseUrl}/admin/logout`, {
        method: "POST",
        credentials: "include"
      });
    } catch (_) {}
    setAuthedUI(false);
    els.loginStatus.textContent = "Signed out.";
    els.kbCount.textContent = "—";
    els.kbTableBody.innerHTML = "";
    els.listStatus.textContent = "";
  };

  // --- events ---
  els.loginBtn.addEventListener("click", login);
  els.logoutBtn.addEventListener("click", logout);

  els.refreshDiag.addEventListener("click", checkDiag);
  els.refreshCount.addEventListener("click", refreshCount);
  els.refreshList.addEventListener("click", refreshList);
  els.addChunk.addEventListener("click", addChunk);
  els.applyLimit.addEventListener("click", refreshList);

  // --- init ---
  (async () => {
    await checkDiag();
    const authed = await checkAuthed(); // if session already valid, unlock UI
    if (authed) {
      await refreshCount();
      await refreshList();
    }
  })();
})();
