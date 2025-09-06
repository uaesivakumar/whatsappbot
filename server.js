import express from "express";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

try { (await import("dotenv")).default.config(); } catch {}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || process.env.VERIFY_TOKEN || "";
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || process.env.ACCESS_TOKEN || "";
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || "";
const PORT = process.env.PORT || 10000;
const ADMIN_USER = process.env.ADMIN_USER || "";
const ADMIN_PASS = process.env.ADMIN_PASS || "";

let _fetch = globalThis.fetch;
if (typeof _fetch !== "function") { const nf = await import("node-fetch"); _fetch = nf.default; }

import fs from "fs";
const intentsPath = path.join(__dirname, "intents.json");
let INTENTS = [];
try {
  if (fs.existsSync(intentsPath)) {
    const txt = fs.readFileSync(intentsPath, "utf8");
    const j = JSON.parse(txt || "[]");
    INTENTS = Array.isArray(j) ? j : [];
  }
} catch {}

function fileExists(p){ try { return fs.existsSync(p); } catch { return false; } }
async function tryImport(p){ try{ if(!fileExists(p)) return null; const u = pathToFileURL(p).href; return await import(u); } catch { return null; } }

const intentsMod = await tryImport(path.join(__dirname, "src/intents/index.js"));
const ragMod = await tryImport(path.join(__dirname, "src/rag/index.js"));
const storeMod = await tryImport(path.join(__dirname, "src/memory/store.js"));
const summarizerMod = await tryImport(path.join(__dirname, "src/memory/summarizer.js"));
const profilesMod = await tryImport(path.join(__dirname, "src/memory/profiles.js"));

const MEMORY = new Map();
function remember(waId, role, text){ const arr = MEMORY.get(waId) || []; arr.push({ role, text, ts: Date.now() }); if (arr.length > 20) arr.splice(0, arr.length - 20); MEMORY.set(waId, arr); }
function recentContext(waId){ return MEMORY.get(waId) || []; }

function naiveDetect(text){
  const t = String(text||"").toLowerCase();
  let best = { name: "unknown", confidence: 0 };
  for(const it of INTENTS){
    const patterns = it.examples || it.utterances || [];
    for(const p of patterns){ if (t.includes(String(p).toLowerCase())) { best = { name: it.name || it.intent || "unknown", confidence: 0.7 }; break; } }
    if (best.name !== "unknown") break;
  }
  return best;
}

async function sendText(to, text){
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const body = { messaging_product: "whatsapp", to, type: "text", text: { body: String(text||"") } };
  const res = await _fetch(url, { method: "POST", headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try { const info = await res.text(); console.log("[OUT]", to, res.status, info?.slice(0, 180)); } catch {}
  return res.ok;
}

async function generateReply({ waId, text }){
  let intentRes;
  try { intentRes = intentsMod?.detectIntent ? await intentsMod.detectIntent(text, INTENTS, { context: recentContext(waId) }) : naiveDetect(text); } catch { intentRes = { name: "unknown", confidence: 0 }; }
  if (intentRes && intentRes.name !== "unknown" && (intentRes.confidence ?? 0) >= 0.6){
    try {
      if (intentsMod?.routeIntent){ const r = await intentsMod.routeIntent(intentRes.name, text, { intents: INTENTS, memory: recentContext(waId), waId }); if (r) return r; }
      if (intentsMod?.handleIntent){ const r = await intentsMod.handleIntent(intentRes.name, text, { intents: INTENTS, memory: recentContext(waId), waId }); if (r) return r; }
    } catch {}
  }
  if (ragMod?.answer){ try { const r = await ragMod.answer(text, { memory: recentContext(waId), userId: waId }); if (r) return r; } catch {}
  }
  return "Hello! How can I assist you today?";
}

const app = express();
app.use(express.json({ limit: "2mb" }));


app.use(async (req,res,next)=>{
  try{
    const tok = req.headers["x-admin-secret"];
    const ok = !!process.env.ADMIN_TOKEN && tok === process.env.ADMIN_TOKEN;
    const p = req.path || req.url;
    if(!ok && (p==="/admin/kb"||p==="/admin/kb/count"||p==="/admin/kb/list"||p==="/admin/reindex")) return res.status(401).json({error:"unauthorized"});
    if(req.method==="POST" && p==="/admin/kb"){
      const body = req.body||{};
      const content = String(body.content||"");
      const meta = body.meta||{};
      if(!content) return res.status(400).json({error:"content required"});
      const split=(t)=>{const s=String(t||"").split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);const out=[];for(const q of s){if(q.length<=800){out.push(q);continue;}for(let i=0;i<q.length;i+=800) out.push(q.slice(i,i+800));}return out.length?out:[String(t||"").slice(0,800)];};
      const db = await sp();
      const now = new Date().toISOString();
      let firstId=null, n=0;
      for(const c of split(content)){
        const { data, error } = await db.from("kb_chunks").insert({ content:c, meta, updated_at:now }).select("id").single();
        if(!error && data){ if(!firstId) firstId = data.id; n++; }
      }
      return res.json({ id:firstId, chunks:n });
    }
    if(req.method==="POST" && p==="/admin/reindex"){
      const db = await sp();
      const { count, error } = await db.from("kb_chunks").select("*",{count:"exact",head:true});
      return res.json({ chunks: error?0:(count||0) });
    }
    if(req.method==="GET" && p==="/admin/kb/count"){
      const db = await sp();
      const { count, error } = await db.from("kb_chunks").select("*",{count:"exact",head:true});
      return res.json({ count: error?0:(count||0) });
    }
    if(req.method==="GET" && p==="/admin/kb/list"){
      const db = await sp();
      const lim = Number(req.query?.limit||20);
      const { data, error } = await db.from("kb_chunks").select("id,meta,updated_at").order("updated_at",{ascending:false}).limit(lim);
      return res.json({ rows: error?[]:(data||[]) });
    }
    return next();
  }catch(e){ return res.status(500).json({error:String(e)}); }
});
function basicAuth(req, res, next){
  if(!ADMIN_USER) return next();
  const hdr = req.headers.authorization || "";
  const parts = hdr.split(" ");
  const ok = parts[0] === "Basic" && Buffer.from(parts[1] || "", "base64").toString() === `${ADMIN_USER}:${ADMIN_PASS}`;
  if(ok) return next();
  res.set("WWW-Authenticate",'Basic realm="console"');
  return res.status(401).end("Auth required");
}

const consoleDir = path.join(__dirname, "console/dist");
if (fs.existsSync(consoleDir)) {
  app.use("/console", basicAuth, express.static(consoleDir));
  const serveConsole = (_req, res) => res.sendFile(path.join(consoleDir, "index.html"));
  app.get("/console", basicAuth, serveConsole);
  app.get("/console/*", basicAuth, serveConsole);
} else {
  app.get("/console", basicAuth, (_req,res)=>res.status(404).send("console not built"));
  app.get("/console/*", basicAuth, (_req,res)=>res.status(404).send("console not built"));
}

app.get("/", (_req,res)=>res.send("OK"));
app.get("/healthz", (_req,res)=>res.json({ ok:true, uptime: process.uptime(), console_dir: fs.existsSync(consoleDir) ? consoleDir : null }));

app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.sendStatus(403);
  } catch { return res.sendStatus(403); }
});

app.post("/webhook", async (req, res) => {
  try {
    res.sendStatus(200);
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const messages = change?.value?.messages || [];
        for (const msg of messages) {
          if (msg.type !== "text") continue;
          const waId = msg?.from;
          const text = msg?.text?.body || "";
          console.log("[IN]", waId, text?.slice(0, 180));
          remember(waId, "user", text);
          try { if (storeMod?.appendMessage) await storeMod.appendMessage({ wa_id: waId, role: "user", text, ts: Date.now() }); } catch {}
          const reply = await generateReply({ waId, text });
          await sendText(waId, reply);
          remember(waId, "bot", reply);
          try { if (storeMod?.appendMessage) await storeMod.appendMessage({ wa_id: waId, role: "bot", text: reply, ts: Date.now() }); } catch {}
        }
      }
    }
  } catch (e) { console.error("webhook error", e); }
});

function adminGuard(req,res,next){
  if(!ADMIN_TOKEN) return res.status(401).json({ error: "admin token not set" });
  const tok = req.headers["x-admin-secret"];
  if (tok && tok === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}

function toISO(x){ if(!x) return null; const d = new Date(x); return isNaN(d) ? null : d.toISOString(); }
function toCSV(rows, headers){
  const esc=(v)=> `"${String(v??"").replace(/"/g,'""')}"`;
  const head = headers.map(esc).join(",");
  const body = rows.map(r => headers.map(h => esc(r[h])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

let _sp = null;
async function sp(){
  if (_sp) return _sp;
  const { createClient } = await import("@supabase/supabase-js");
  _sp = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _sp;
}

app.get("/admin/messages", adminGuard, async (req,res)=>{
  try{
    const waId = req.query.waId || req.query.waid || "";
    const from = toISO(req.query.from || req.query.from_iso);
    const to = toISO(req.query.to || req.query.to_iso);
    const db = await sp();
    let q = db.from("messages").select("role,text,ts,wa_id").eq("wa_id", waId).order("ts",{ascending:true});
    if(from) q = q.gte("ts", Math.floor(new Date(from).getTime()));
    if(to) q = q.lte("ts", Math.floor(new Date(to).getTime()));
    const { data, error } = await q.limit(2000);
    if(error) return res.status(500).json({error:error.message});
    return res.json({ waId, count: data?.length||0, messages: data||[] });
  }catch(e){ return res.status(500).json({error:String(e)}); }
});

app.get("/admin/messages.csv", adminGuard, async (req,res)=>{
  try{
    const waId = req.query.waId || req.query.waid || "";
    const from = toISO(req.query.from || req.query.from_iso);
    const to = toISO(req.query.to || req.query.to_iso);
    const db = await sp();
    let q = db.from("messages").select("role,text,ts,wa_id").eq("wa_id", waId).order("ts",{ascending:true});
    if(from) q = q.gte("ts", Math.floor(new Date(from).getTime()));
    if(to) q = q.lte("ts", Math.floor(new Date(to).getTime()));
    const { data, error } = await q.limit(5000);
    if(error) return res.status(500).send(error.message);
    const rows = (data||[]).map(r=>({role:r.role,text:r.text,ts:r.ts}));
    const csv = toCSV(rows,["role","text","ts"]);
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="messages_${waId}.csv"`);
    return res.send(csv);
  }catch(e){ return res.status(500).send(String(e)); }
});

app.get("/admin/profile", adminGuard, async (req,res)=>{
  try{
    const waId = String(req.query.waId || "");
    let profile = null;
    if (profilesMod?.getProfile) profile = await profilesMod.getProfile(waId);
    return res.json({ waId, profile });
  }catch{ return res.status(500).json({ error: "failed" }); }
});

app.post("/admin/profile", adminGuard, async (req,res)=>{
  try{
    const waId = String(req.body.waId || "");
    const data = req.body || {};
    if (profilesMod?.upsertProfile) {
      const profile = await profilesMod.upsertProfile(waId, data);
      return res.json({ waId, profile, saved: true });
    }
    return res.json({ waId, saved: false });
  }catch{ return res.status(500).json({ error: "failed" }); }
});

app.get("/admin/search", adminGuard, async (req,res)=>{
  try{
    const q = { company: req.query.company || "", prefers: req.query.prefers || "", min_salary: req.query.min_salary || req.query.minSalary || "" };
    let rows = [];
    if (profilesMod?.searchProfiles) rows = await profilesMod.searchProfiles(q);
    return res.json({ count: rows?.length || 0, rows: rows || [] });
  }catch{ return res.status(500).json({ error: "failed" }); }
});

app.get("/admin/search.csv", adminGuard, async (req,res)=>{
  try{
    const q = { company: req.query.company || "", prefers: req.query.prefers || "", min_salary: req.query.min_salary || req.query.minSalary || "" };
    let rows = [];
    if (profilesMod?.searchProfiles) rows = await profilesMod.searchProfiles(q);
    const header = "wa_id,company,salary_aed,prefers,liabilities_aed,notes,updated_at";
    const out = [header, ...(rows || []).map(r => `"${r.wa_id}","${r.company || ""}","${r.salary_aed ?? ""}","${r.prefers || ""}","${r.liabilities_aed ?? ""}","${(r.notes || "").replace(/"/g, '""')}","${r.updated_at || ""}"`)].join("\n");
    res.setHeader("Content-Type", "text/csv");
    return res.send(out);
  }catch{ return res.status(500).send("error"); }
});

app.get("/admin/kb/count", adminGuard, async (_req,res)=>{
  try{
    if (ragMod?.count){ const c = await ragMod.count(); return res.json({ count: c || 0 }); }
    return res.json({ count: 0 });
  }catch{ return res.status(500).json({ error: "failed" }); }
});

app.get("/admin/kb/list", adminGuard, async (req,res)=>{
  try{
    const limit = Number(req.query.limit || 20);
    if (ragMod?.list){ const rows = await ragMod.list({ limit }); return res.json({ rows: rows || [] }); }
    return res.json({ rows: [] });
  }catch{ return res.status(500).json({ error: "failed" }); }
});

app.post("/admin/kb", adminGuard, async (req,res)=>{
  try{
    const content = String(req.body?.content || "");
    const meta = req.body?.meta || {};
    if (!content) return res.status(400).json({ error: "content required" });
    if (ragMod?.upsertOne){ const r = await ragMod.upsertOne(content, meta); return res.json({ id: r?.id || null }); }
    return res.json({ id: null });
  }catch{ return res.status(500).json({ error: "failed" }); }
});

app.post("/admin/kb/upload", adminGuard, async (req,res)=>{
  try{
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [{ content: body.content, meta: { src: body.filename || "upload" } }];
    if (!ragMod?.upsertOne) return res.json({ uploaded: 0 });
    let n=0; for(const it of items){ if(!it?.content) continue; await ragMod.upsertOne(it.content, it.meta||{}); n++; }
    return res.json({ uploaded:n });
  }catch(e){ return res.status(500).json({error:String(e)}); }
});

app.post("/admin/reindex", adminGuard, async (_req,res)=>{
  try{
    if (ragMod?.reindex){ const r = await ragMod.reindex(); return res.json({ chunks: r?.chunks || 0 }); }
    return res.json({ chunks: 0 });
  }catch{ return res.status(500).json({ error: "failed" }); }
});

app.get("/admin/rag", adminGuard, async (req,res)=>{
  try{
    const q = String(req.query.q || "");
    if (!q) return res.json({ hits: [], answer: null });
    const k = Math.max(1, Math.min(50, Number(req.query.k || 5) || 5));
    const minSim = req.query.min_similarity != null ? Number(req.query.min_similarity) : undefined;
    if (ragMod?.retrieve && ragMod?.answer){
      const opts = { k }; if (!Number.isNaN(minSim)) opts.minSimilarity = minSim;
      const hits = (await ragMod.retrieve(q, opts)) || [];
      const answer = await ragMod.answer(q, {});
      return res.json({ hits, answer });
    }
    return res.json({ hits: [], answer: null });
  }catch{ return res.status(500).json({ error: "failed" }); }
});

let OPS_LAST_RUN = 0;
let OPS_LAST_OK = null;

app.get("/admin/ops/status", adminGuard, (_req,res)=>{
  const enabled = !!process.env.CRON_INTERVAL_MS;
  return res.json({ enabled, interval_ms: Number(process.env.CRON_INTERVAL_MS||0), last_run_ts: OPS_LAST_RUN, last_result: OPS_LAST_OK });
});

app.post("/admin/ops/run", adminGuard, async (_req,res)=>{
  try{
    OPS_LAST_RUN = Date.now();
    try { await import("./src/memory/summarizer.js"); OPS_LAST_OK = true; return res.json({ ok:true, ts: OPS_LAST_RUN }); }
    catch(e){ OPS_LAST_OK = false; return res.status(500).json({ ok:false, error:String(e) }); }
  }catch(e){ return res.status(500).json({ ok:false, error:String(e) }); }
});

if (process.env.CRON_INTERVAL_MS) {
  const ms = Number(process.env.CRON_INTERVAL_MS);
  setInterval(async () => {
    try { OPS_LAST_RUN = Date.now(); OPS_LAST_OK = true; }
    catch { OPS_LAST_OK = false; }
  }, isNaN(ms) || ms < 60000 ? 300000 : ms);
}

app.listen(PORT, ()=>{ console.log(`listening on ${PORT}`); });
