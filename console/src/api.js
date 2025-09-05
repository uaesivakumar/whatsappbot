const BASE = "";

function headers() {
  const token = localStorage.getItem("ADMIN_TOKEN") || "";
  return { "x-admin-secret": token, "Content-Type": "application/json" };
}

export async function health() {
  const r = await fetch(`${BASE}/healthz`);
  return r.json();
}

export async function kbCount() {
  const r = await fetch(`${BASE}/admin/kb/count`, { headers: headers() });
  if (!r.ok) throw new Error("kb count");
  return r.json();
}

export async function kbList(limit = 10) {
  const r = await fetch(`${BASE}/admin/kb/list?limit=${limit}`, { headers: headers() });
  if (!r.ok) throw new Error("kb list");
  return r.json();
}

export async function kbAdd(content, meta = {}) {
  const r = await fetch(`${BASE}/admin/kb`, { method: "POST", headers: headers(), body: JSON.stringify({ content, meta }) });
  if (!r.ok) throw new Error("kb add");
  return r.json();
}

export async function kbReindex() {
  const r = await fetch(`${BASE}/admin/reindex`, { method: "POST", headers: headers() });
  if (!r.ok) throw new Error("reindex");
  return r.json();
}

export async function messages(waId, limit = 50) {
  const r = await fetch(`${BASE}/admin/messages?waId=${encodeURIComponent(waId)}&limit=${limit}`, { headers: headers() });
  if (!r.ok) throw new Error("messages");
  return r.json();
}

export async function summary(waId) {
  const r = await fetch(`${BASE}/admin/summary?waId=${encodeURIComponent(waId)}`, { headers: headers() });
  if (!r.ok) throw new Error("summary");
  return r.json();
}

export async function searchProfiles(params) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}/admin/search?${q}`, { headers: headers() });
  if (!r.ok) throw new Error("search");
  return r.json();
}
