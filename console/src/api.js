const H = () => {
  const h = {};
  const t = window.ADMIN_TOKEN || localStorage.getItem("ADMIN_TOKEN");
  if (t) h["x-admin-secret"] = t;
  return h;
};

export async function health() {
  const r = await fetch("/healthz");
  return r.json();
}

export async function kbCount() {
  const r = await fetch("/admin/kb/count", { headers: H() });
  return r.json();
}

export async function kbList(limit = 20) {
  const r = await fetch(`/admin/kb/list?limit=${limit}`, { headers: H() });
  return r.json();
}

export async function kbAdd(content, meta = {}) {
  const r = await fetch("/admin/kb/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...H() },
    body: JSON.stringify({ items: [{ content, meta }] })
  });
  return r.json();
}

export async function kbBulk(items) {
  const r = await fetch("/admin/kb/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...H() },
    body: JSON.stringify({ items })
  });
  return r.json();
}

export async function kbReindex() {
  const r = await fetch("/admin/reindex", { method: "POST", headers: H() });
  return r.json();
}

export async function messagesList(waId, fromIso, toIso) {
  const p = new URLSearchParams({ waId });
  if (fromIso) p.set("from", fromIso);
  if (toIso) p.set("to", toIso);
  const r = await fetch(`/admin/messages?${p.toString()}`, { headers: H() });
  return r.json();
}

export function messagesExportCsv(waId, fromIso, toIso) {
  const p = new URLSearchParams({ waId });
  if (fromIso) p.set("from", fromIso);
  if (toIso) p.set("to", toIso);
  window.open(`/admin/messages.csv?${p.toString()}`, "_blank");
}

export async function profileGet(waId) {
  const r = await fetch(`/admin/profile?waId=${waId}`, { headers: H() });
  return r.json();
}

export async function profileSave(payload) {
  const r = await fetch("/admin/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...H() },
    body: JSON.stringify(payload)
  });
  return r.json();
}

export async function profileSearch(q) {
  const p = new URLSearchParams(q);
  const r = await fetch(`/admin/search?${p.toString()}`, { headers: H() });
  return r.json();
}

export function profilesExportCsv(q) {
  const p = new URLSearchParams(q);
  window.open(`/admin/profiles/export.csv?${p.toString()}`, "_blank");
}

export async function profilesImportCsv(text) {
  const r = await fetch("/admin/profiles/import", {
    method: "POST",
    headers: { "Content-Type": "text/plain", ...H() },
    body: text
  });
  return r.json();
}

export async function opsStatus() {
  const r = await fetch("/admin/ops/status", { headers: H() });
  return r.json();
}

export async function opsRun() {
  const r = await fetch("/admin/ops/run", { method: "POST", headers: H() });
  return r.json();
}
