const base = "";
const hdrs = () => {
  const token = localStorage.getItem("ADMIN_TOKEN") || "";
  return { "x-admin-secret": token, "Content-Type": "application/json" };
};
export async function health() {
  const r = await fetch(`${base}/healthz`);
  return r.json();
}
export async function kbCount() {
  const r = await fetch(`${base}/admin/kb/count`, { headers: hdrs() });
  return r.json();
}
export async function kbList(limit = 10) {
  const r = await fetch(`${base}/admin/kb/list?limit=${limit}`, { headers: hdrs() });
  return r.json();
}
export async function kbAdd(content, meta = {}) {
  const r = await fetch(`${base}/admin/kb`, { method: "POST", headers: hdrs(), body: JSON.stringify({ content, meta }) });
  return r.json();
}
export async function reindex() {
  const r = await fetch(`${base}/admin/reindex`, { method: "POST", headers: hdrs() });
  return r.json();
}
export async function messages(waId, limit = 50) {
  const r = await fetch(`${base}/admin/messages?waId=${encodeURIComponent(waId)}&limit=${limit}`, { headers: hdrs() });
  return r.json();
}
export async function profileGet(waId) {
  const r = await fetch(`${base}/admin/profile?waId=${encodeURIComponent(waId)}`, { headers: hdrs() });
  return r.json();
}
export async function profileUpsert(data) {
  const r = await fetch(`${base}/admin/profile`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) });
  return r.json();
}
export async function profilesSearch(qs = {}) {
  const q = new URLSearchParams(qs).toString();
  const r = await fetch(`${base}/admin/search?${q}`, { headers: hdrs() });
  return r.json();
}
