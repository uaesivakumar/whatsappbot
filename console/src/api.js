const BASE = "";
const tok = () => localStorage.getItem("ADMIN_TOKEN") || localStorage.getItem("admin_token") || "";
const H = () => ({ "x-admin-secret": tok(), "Content-Type": "application/json" });

export const kbAdd   = (content, meta={}) => fetch(`${BASE}/admin/kb`,         { method:"POST", headers:H(), body:JSON.stringify({content,meta}) }).then(r=>r.json());
export const kbCount = ()                 => fetch(`${BASE}/admin/kb/count`,   { headers:H() }).then(r=>r.json());
export const kbList  = (limit=20)         => fetch(`${BASE}/admin/kb/list?limit=${limit}`, { headers:H() }).then(r=>r.json());
export const reindex = ()                 => fetch(`${BASE}/admin/reindex`,    { method:"POST", headers:H() }).then(r=>r.json());
